import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Deep merge two objects. Arrays are replaced, not merged.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      result[key] = sourceVal;
    }
  }
  
  return result;
}

interface MergeRequest {
  organization_id: string;
  patch: Record<string, unknown>;
}

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Validate user token using getUser (more reliable in Deno than getClaims)
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    
    if (userError || !userData?.user?.id) {
      console.error('[settings-merge] Auth error:', userError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log('[settings-merge] User:', userId);

    // Parse request
    const body: MergeRequest = await req.json();
    const { organization_id, patch } = body;

    if (!organization_id || !patch) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing organization_id or patch' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for DB operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check user is member of org (via profiles)
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .single();

    if (profileError || !profile) {
      console.error('[settings-merge] Profile check failed:', profileError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only owner/admin can modify settings
    if (!['owner', 'admin'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[settings-merge] Org:', organization_id, 'Role:', profile.role);

    // Get current settings
    const { data: settings, error: fetchError } = await adminClient
      .from('bot_settings')
      .select('settings_json')
      .eq('organization_id', organization_id)
      .single();

    if (fetchError) {
      console.error('[settings-merge] Fetch error:', fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to fetch settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentJson = (settings?.settings_json as Record<string, unknown>) || {};
    
    // Deep merge patch into current
    const merged = deepMerge(currentJson, patch);

    console.log('[settings-merge] Merging patch into settings_json');

    // Update with merged result
    const { error: updateError } = await adminClient
      .from('bot_settings')
      .update({ 
        settings_json: merged,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', organization_id);

    if (updateError) {
      console.error('[settings-merge] Update error:', updateError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to update settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[settings-merge] Success');

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[settings-merge] Error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
