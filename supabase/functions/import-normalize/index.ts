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

interface ApplyStatusRequest {
  op: 'apply_status';
  organization_id: string;
  import_job_id: string;
  apply_id: string;
}

// NEW: Preview rows request (fetches catalog data by group filter)
interface PreviewRowsRequest {
  op: 'preview_rows';
  organization_id: string;
  import_job_id?: string;
  group_type?: 'WIDTH' | 'COLOR' | 'COATING' | 'DECOR' | 'THICKNESS';
  filter_key?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// NEW: AI Chat request (structured patches only)
interface ChatRequest {
  op: 'chat';
  organization_id: string;
  import_job_id?: string;
  message: string;
  context?: {
    group_type: string;
    group_key: string;
    affected_count: number;
    examples: string[];
  };
}

type NormalizeRequest = DryRunRequest | ApplyRequest | ApplyStatusRequest | PreviewRowsRequest | ChatRequest;

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
    const { op, organization_id } = body;

    // import_job_id is optional for preview_rows and chat operations
    const import_job_id = (body as { import_job_id?: string }).import_job_id;

    if (!op || !organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: op, organization_id' }),
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

    // For operations that require import_job_id, verify it exists
    const opsRequiringJob = ['dry_run', 'apply', 'apply_status'];
    if (opsRequiringJob.includes(op) && import_job_id && import_job_id !== 'current') {
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
    } else {
      console.log(`[import-normalize] Op: ${op}, Org: ${organization_id}`);
    }

    // Build headers for Cloud Run enricher
    const enricherHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (enricherSecret) {
      enricherHeaders['X-Internal-Secret'] = enricherSecret;
    }

    // =========================================
    // Handle apply_status (polling for async apply)
    // =========================================
    if (op === 'apply_status') {
      const statusBody = body as ApplyStatusRequest;
      if (!statusBody.apply_id) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing apply_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const statusEndpoint = `${enricherUrl}/api/enrich/apply/status`;
      console.log(`[import-normalize] Polling apply status: ${statusBody.apply_id}`);

      const statusResponse = await fetch(statusEndpoint, {
        method: 'POST',
        headers: enricherHeaders,
        body: JSON.stringify({
          organization_id,
          import_job_id,
          apply_id: statusBody.apply_id,
        }),
      });

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        console.error('[import-normalize] Status check error:', statusResponse.status, statusData);
        return new Response(
          JSON.stringify({ ok: false, error: statusData.error || 'Status check failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(statusData),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle dry_run
    // =========================================
    if (op === 'dry_run') {
      const dryRunBody = body as DryRunRequest;
      const enricherEndpoint = `${enricherUrl}/api/enrich/dry_run`;
      
      // Apply limit cap but preserve user's ai_suggest preference (default TRUE for value)
      const requestedScope = dryRunBody.scope || {};
      const enricherPayload = {
        organization_id,
        import_job_id,
        scope: { 
          only_where_null: requestedScope.only_where_null ?? true, 
          limit: Math.min(requestedScope.limit ?? 500, 1000)
        },
        // AI suggestions ON by default - main feature value
        ai_suggest: dryRunBody.ai_suggest ?? true,
      };

      console.log(`[import-normalize] Calling ${enricherEndpoint}, ai_suggest:`, enricherPayload.ai_suggest);

      // Add timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      let enricherResponse: Response;
      try {
        enricherResponse = await fetch(enricherEndpoint, {
          method: 'POST',
          headers: enricherHeaders,
          body: JSON.stringify(enricherPayload),
          signal: controller.signal,
        });
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          console.error('[import-normalize] dry_run timed out after 55s');
          return new Response(
            JSON.stringify({
              ok: false,
              code: 'TIMEOUT',
              error: 'Enricher request timed out (55s). Retry with smaller limit.',
              recommended_limit: 250,
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
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[import-normalize] dry_run OK, questions:', enricherData.questions?.length || 0);
      return new Response(
        JSON.stringify(enricherData),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle apply (async start + optional poll)
    // =========================================
    if (op === 'apply') {
      const applyBody = body as ApplyRequest;
      if (!applyBody.run_id || !applyBody.profile_hash) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing run_id or profile_hash for apply' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Try async apply endpoint first (start + return apply_id)
      const applyStartEndpoint = `${enricherUrl}/api/enrich/apply/start`;
      console.log(`[import-normalize] Starting async apply at ${applyStartEndpoint}`);

      // Short timeout for start - should return quickly
      const startController = new AbortController();
      const startTimeoutId = setTimeout(() => startController.abort(), 10000); // 10s for start

      let startResponse: Response;
      let useAsyncMode = true;

      try {
        startResponse = await fetch(applyStartEndpoint, {
          method: 'POST',
          headers: enricherHeaders,
          body: JSON.stringify({
            organization_id,
            import_job_id,
            run_id: applyBody.run_id,
            profile_hash: applyBody.profile_hash,
          }),
          signal: startController.signal,
        });
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        // If async endpoint doesn't exist (404) or times out, fallback to sync
        console.log('[import-normalize] Async start failed, trying sync mode:', name);
        useAsyncMode = false;
        startResponse = null as unknown as Response;
      } finally {
        clearTimeout(startTimeoutId);
      }

      // If async start succeeded
      if (useAsyncMode && startResponse && startResponse.ok) {
        const startData = await startResponse.json();
        console.log('[import-normalize] Async apply started, apply_id:', startData.apply_id);
        
        return new Response(
          JSON.stringify({
            ok: true,
            apply_id: startData.apply_id,
            status: 'PENDING',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fallback to synchronous apply (for backward compatibility or small datasets)
      const syncApplyEndpoint = `${enricherUrl}/api/enrich/apply`;
      console.log(`[import-normalize] Using sync apply at ${syncApplyEndpoint}`);

      const syncController = new AbortController();
      const syncTimeoutId = setTimeout(() => syncController.abort(), 55000);

      let syncResponse: Response;
      try {
        syncResponse = await fetch(syncApplyEndpoint, {
          method: 'POST',
          headers: enricherHeaders,
          body: JSON.stringify({
            organization_id,
            import_job_id,
            run_id: applyBody.run_id,
            profile_hash: applyBody.profile_hash,
          }),
          signal: syncController.signal,
        });
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          console.error('[import-normalize] Sync apply timed out after 55s');
          return new Response(
            JSON.stringify({
              ok: false,
              code: 'TIMEOUT',
              error: 'Apply timed out. Please try again.',
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.error('[import-normalize] Sync apply fetch error:', fetchError);
        throw fetchError;
      } finally {
        clearTimeout(syncTimeoutId);
      }

      const syncData = await syncResponse.json();

      if (!syncResponse.ok) {
        console.error('[import-normalize] Sync apply error:', syncResponse.status, syncData);
        return new Response(
          JSON.stringify({ 
            ok: false, 
            error: syncData.error || syncData.detail || 'Apply failed',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[import-normalize] Sync apply OK, patched_rows:', syncData.patched_rows);
      return new Response(
        JSON.stringify(syncData),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle preview_rows (fetch catalog data by group filter)
    // =========================================
    if (op === 'preview_rows') {
      const previewBody = body as PreviewRowsRequest;
      const previewEndpoint = `${enricherUrl}/api/enrich/preview_rows`;
      
      const previewPayload = {
        organization_id,
        import_job_id: previewBody.import_job_id || 'current',
        group_type: previewBody.group_type,
        filter_key: previewBody.filter_key,
        q: previewBody.q,
        limit: Math.min(previewBody.limit ?? 50, 500),
        offset: previewBody.offset ?? 0,
      };

      console.log(`[import-normalize] preview_rows: filter_key=${previewPayload.filter_key}, limit=${previewPayload.limit}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let previewResponse: Response;
      try {
        previewResponse = await fetch(previewEndpoint, {
          method: 'POST',
          headers: enricherHeaders,
          body: JSON.stringify(previewPayload),
          signal: controller.signal,
        });
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          console.error('[import-normalize] preview_rows timed out');
          return new Response(
            JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Preview request timed out.' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      const previewData = await previewResponse.json();

      if (!previewResponse.ok) {
        console.error('[import-normalize] preview_rows error:', previewResponse.status, previewData);
        return new Response(
          JSON.stringify({ ok: false, error: previewData.error || 'Preview failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...previewData }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle chat (AI commands for structured patches)
    // =========================================
    if (op === 'chat') {
      const chatBody = body as ChatRequest;
      if (!chatBody.message) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing message' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const chatEndpoint = `${enricherUrl}/api/enrich/chat`;
      
      const chatPayload = {
        organization_id,
        import_job_id: chatBody.import_job_id || 'current',
        message: chatBody.message,
        context: chatBody.context || null,
      };

      console.log(`[import-normalize] chat: message="${chatBody.message.substring(0, 50)}...", context=${JSON.stringify(chatBody.context)}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      let chatResponse: Response;
      try {
        chatResponse = await fetch(chatEndpoint, {
          method: 'POST',
          headers: enricherHeaders,
          body: JSON.stringify(chatPayload),
          signal: controller.signal,
        });
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          console.error('[import-normalize] chat timed out');
          return new Response(
            JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'AI request timed out.' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      const chatData = await chatResponse.json();

      if (!chatResponse.ok) {
        console.error('[import-normalize] chat error:', chatResponse.status, chatData);
        return new Response(
          JSON.stringify({ ok: false, error: chatData.error || 'Chat failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Response should contain structured patch data
      return new Response(
        JSON.stringify({ ok: true, ...chatData }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Unknown op
    return new Response(
      JSON.stringify({ ok: false, error: `Unknown op: ${op}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      console.error('[import-normalize] AbortError bubbled to top-level:', err);
      return new Response(
        JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Request timed out.' }),
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
