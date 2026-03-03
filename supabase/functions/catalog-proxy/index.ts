/**
 * catalog-proxy — Secure proxy for pricing-api-saas.
 * 
 * Prevents direct browser access to Cloud Run.
 * Verifies JWT + org membership before forwarding requests.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pricingApiUrl = Deno.env.get('PRICING_API_SAAS_URL');

    if (!pricingApiUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Pricing API not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { endpoint, organization_id, params } = body as {
      endpoint: string;
      organization_id: string;
      params?: Record<string, string | number>;
    };

    if (!endpoint || !organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing endpoint or organization_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate endpoint — only allow known paths
    const allowedEndpoints = ['/api/catalog/items', '/api/catalog/facets'];
    if (!allowedEndpoints.includes(endpoint)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Endpoint not allowed: ${endpoint}` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Membership check ---
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied: not a member of this organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Build upstream URL ---
    const url = new URL(`${pricingApiUrl}${endpoint}`);
    url.searchParams.set('organization_id', organization_id);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    console.log(`[catalog-proxy] ${endpoint} org=${organization_id} user=${userId}`);

    // --- Forward request ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const upstream = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      const rawText = await upstream.text();
      clearTimeout(timeoutId);

      if (!upstream.ok) {
        console.error(`[catalog-proxy] Upstream error ${upstream.status}: ${rawText.substring(0, 200)}`);
        return new Response(
          JSON.stringify({ ok: false, error: `Upstream error: ${upstream.status}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Forward JSON response as-is
      return new Response(rawText, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      const name = (fetchError as { name?: string })?.name;
      if (name === 'AbortError') {
        return new Response(
          JSON.stringify({ ok: false, error: 'Request timed out' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchError;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[catalog-proxy] Error:', message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
