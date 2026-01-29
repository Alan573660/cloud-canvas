import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DryRunRequest {
  op: 'dry_run';
  organization_id: string;
  import_job_id: string;
  scope?: {
    only_where_null?: boolean;
    limit?: number;
  };
  ai_suggest?: boolean;
}

interface ApplyRequest {
  op: 'apply';
  organization_id: string;
  import_job_id: string;
  run_id: string;
  profile_hash: string;
}

type NormalizeRequest = DryRunRequest | ApplyRequest;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
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

    // Get Cloud Run enricher config from secrets
    const enricherUrl = Deno.env.get('CATALOG_ENRICHER_URL');
    const enricherSecret = Deno.env.get('ENRICH_SHARED_SECRET');

    if (!enricherUrl) {
      console.error('[import-normalize] CATALOG_ENRICHER_URL not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'Enricher not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate user token using getUser (more reliable in Deno than getClaims)
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    
    if (userError || !userData?.user?.id) {
      console.error('[import-normalize] Auth error:', userError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;

    // Parse request
    const body: NormalizeRequest = await req.json();
    const { op, organization_id, import_job_id } = body;

    if (!op || !organization_id || !import_job_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: op, organization_id, import_job_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for permission check
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check user is member of org
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .single();

    if (profileError || !profile) {
      console.error('[import-normalize] Profile check failed:', profileError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify import job exists and belongs to org
    const { data: job, error: jobError } = await adminClient
      .from('import_jobs')
      .select('id, status')
      .eq('id', import_job_id)
      .eq('organization_id', organization_id)
      .single();

    if (jobError || !job) {
      console.error('[import-normalize] Job not found:', jobError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Import job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[import-normalize] Op: ${op}, Job: ${import_job_id}, Status: ${job.status}`);

    // Build Cloud Run request
    let enricherEndpoint: string;
    let enricherPayload: Record<string, unknown>;

    if (op === 'dry_run') {
      enricherEndpoint = `${enricherUrl}/api/enrich/dry_run`;
      // Reduce default limit to prevent memory exhaustion in Edge Runtime
      const requestedScope = (body as DryRunRequest).scope || {};
      enricherPayload = {
        organization_id,
        import_job_id,
        scope: { 
          only_where_null: requestedScope.only_where_null ?? true, 
          limit: Math.min(requestedScope.limit ?? 500, 1000) // Cap at 1000 rows (reduced for faster response)
        },
        ai_suggest: (body as DryRunRequest).ai_suggest ?? false, // Disable AI for faster processing
      };
    } else if (op === 'apply') {
      const applyBody = body as ApplyRequest;
      if (!applyBody.run_id || !applyBody.profile_hash) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing run_id or profile_hash for apply' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      enricherEndpoint = `${enricherUrl}/api/enrich/apply`;
      enricherPayload = {
        organization_id,
        import_job_id,
        run_id: applyBody.run_id,
        profile_hash: applyBody.profile_hash,
      };
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: `Unknown op: ${op}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[import-normalize] Calling ${enricherEndpoint}`);

    // Build headers for Cloud Run enricher
    const enricherHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (enricherSecret) {
      enricherHeaders['X-Internal-Secret'] = enricherSecret;
    }

    // Add timeout with AbortController to prevent Edge Runtime resource exhaustion
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout (Edge has 60s limit)

    let enricherResponse: Response;
    try {
      enricherResponse = await fetch(enricherEndpoint, {
        method: 'POST',
        headers: enricherHeaders,
        body: JSON.stringify(enricherPayload),
        signal: controller.signal,
      });
    } catch (fetchError: unknown) {
      // IMPORTANT: In Deno, AbortError can be a DOMException (not instanceof Error)
      const name = (fetchError as { name?: string } | null)?.name;
      if (name === 'AbortError') {
        console.error('[import-normalize] Request timed out after 55s');
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'TIMEOUT',
            error: 'Enricher request timed out (55s). Please retry, or reduce scope.limit.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.error('[import-normalize] Fetch error:', fetchError);
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    const enricherData = await enricherResponse.json();

    if (!enricherResponse.ok) {
      console.error('[import-normalize] Enricher error:', enricherResponse.status, enricherData);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: enricherData.error || enricherData.detail || 'Enricher request failed',
          status_code: enricherResponse.status
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[import-normalize] Enricher response OK');

    // Return enricher response as-is
    return new Response(
      JSON.stringify(enricherData),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      console.error('[import-normalize] AbortError bubbled to top-level (returning 200):', err);
      return new Response(
        JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Enricher request timed out (55s).' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('[import-normalize] Error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
