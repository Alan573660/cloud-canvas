import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Safe JSON parser: handles non-JSON responses from enricher gracefully
async function safeJsonParse(response: Response): Promise<{ data: Record<string, unknown> | null; rawText: string }> {
  const rawText = await response.text();
  try {
    const data = JSON.parse(rawText);
    return { data, rawText };
  } catch {
    return { data: null, rawText };
  }
}

function enricherErrorResponse(status: number, rawText: string, fallbackMsg: string) {
  const preview = rawText.substring(0, 200);
  console.error(`[import-normalize] Enricher returned non-JSON (status ${status}): ${preview}`);
  return new Response(
    JSON.stringify({
      ok: false,
      error: fallbackMsg,
      detail: `Enricher returned status ${status} with non-JSON body. Preview: ${preview}`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

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
  run_id?: string;
}

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

interface AnswerQuestionRequest {
  op: 'answer_question';
  organization_id: string;
  import_job_id?: string;
  question_type: string;
  token: string;
  value: string | number;
}

interface StatsRequest {
  op: 'stats';
  organization_id: string;
  import_job_id?: string;
}

interface DashboardRequest {
  op: 'dashboard';
  organization_id: string;
  import_job_id?: string;
}

interface TreeRequest {
  op: 'tree';
  organization_id: string;
}

interface ConfirmRequest {
  op: 'confirm';
  organization_id: string;
  import_job_id: string;
  type: string;
  payload: Record<string, unknown>;
}

type NormalizeRequest = DryRunRequest | ApplyRequest | ApplyStatusRequest | PreviewRowsRequest | ChatRequest | AnswerQuestionRequest | StatsRequest | DashboardRequest | TreeRequest | ConfirmRequest;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const enricherUrl = Deno.env.get('CATALOG_ENRICHER_URL');
    const enricherSecret = Deno.env.get('ENRICH_SHARED_SECRET');

    if (!enricherUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Enricher not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Diagnostic: log enricher base URL on every call
    console.log(`[import-normalize] enricher_base_url= ${enricherUrl}`);

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
    const body: NormalizeRequest = await req.json();
    const { op, organization_id } = body;
    const import_job_id = (body as { import_job_id?: string }).import_job_id;

    if (!op || !organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: op, organization_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const opsRequiringJob = ['dry_run', 'apply', 'apply_status'];
    if (opsRequiringJob.includes(op) && import_job_id && import_job_id !== 'current') {
      const { data: job, error: jobError } = await adminClient
        .from('import_jobs')
        .select('id, status')
        .eq('id', import_job_id)
        .eq('organization_id', organization_id)
        .single();

      if (jobError || !job) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Import job not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[import-normalize] Op: ${op}, Job: ${import_job_id}, Status: ${job.status}`);
    } else {
      console.log(`[import-normalize] Op: ${op}, Org: ${organization_id}`);
    }

    const enricherHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (enricherSecret) {
      enricherHeaders['X-Internal-Secret'] = enricherSecret;
    }

    // ── Helper to call enricher safely ──
    async function callEnricher(endpoint: string, method: 'GET' | 'POST', payload?: unknown, timeoutMs = 55000) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      console.log(`[import-normalize] -> ${method} ${endpoint}`);

      try {
        const fetchOpts: RequestInit = {
          method,
          headers: enricherHeaders,
          signal: controller.signal,
        };
        if (method === 'POST' && payload !== undefined) {
          fetchOpts.body = JSON.stringify(payload);
        }

        const response = await fetch(endpoint, fetchOpts);
        const { data, rawText } = await safeJsonParse(response);

        // Diagnostic: log status and body preview on non-2xx
        if (!response.ok) {
          console.error(`[import-normalize] <- ${response.status} ${rawText.substring(0, 300)}`);
        } else {
          console.log(`[import-normalize] <- ${response.status} OK`);
        }

        if (data === null) {
          return { ok: false as const, status: response.status, rawText, data: null };
        }
        return { ok: response.ok, status: response.status, rawText, data };
      } catch (fetchError: unknown) {
        const name = (fetchError as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          console.error(`[import-normalize] <- TIMEOUT after ${timeoutMs}ms`);
          return { ok: false as const, status: 0, rawText: '', data: null, timeout: true };
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // =========================================
    // Handle apply_status
    // =========================================
    if (op === 'apply_status') {
      const statusBody = body as ApplyStatusRequest;
      const applyId = statusBody.apply_id || statusBody.run_id;
      if (!applyId) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing apply_id or run_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const statusEndpoint = `${enricherUrl}/api/enrich/apply_status?import_job_id=${encodeURIComponent(import_job_id || 'current')}&apply_id=${encodeURIComponent(applyId)}&organization_id=${encodeURIComponent(organization_id)}`;
      console.log(`[import-normalize] Polling apply status: ${applyId}`);

      const result = await callEnricher(statusEndpoint, 'GET', undefined, 15000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Status check timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Status check returned non-JSON');
      }
      if (!result.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: (result.data as Record<string, unknown>).error || 'Status check failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(result.data),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle dry_run
    // =========================================
    if (op === 'dry_run') {
      const dryRunBody = body as DryRunRequest;
      const requestedScope = dryRunBody.scope || {};
      const enricherPayload = {
        organization_id,
        import_job_id,
        scope: {
          only_where_null: requestedScope.only_where_null ?? true,
          limit: Math.min(requestedScope.limit ?? 2000, 3000),
        },
        ai_suggest: dryRunBody.ai_suggest ?? false,
      };

      console.log(`[import-normalize] Calling dry_run, ai_suggest:`, enricherPayload.ai_suggest);

      const result = await callEnricher(`${enricherUrl}/api/enrich/dry_run`, 'POST', enricherPayload);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Enricher request timed out (55s). Retry with smaller limit.', recommended_limit: 250 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Enricher dry_run returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Enricher request failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[import-normalize] dry_run OK, questions:', (result.data as Record<string, unknown[]>).questions?.length || 0);
      return new Response(
        JSON.stringify(result.data),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle apply — async first (apply_start), then sync fallback
    // =========================================
    if (op === 'apply') {
      const applyBody = body as ApplyRequest;
      if (!applyBody.run_id || !applyBody.profile_hash) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing run_id or profile_hash for apply' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const applyPayload = {
        organization_id,
        import_job_id,
        run_id: applyBody.run_id,
        profile_hash: applyBody.profile_hash,
      };

      // Try async start first: POST /api/enrich/apply_start (underscore, not /apply/start)
      const startResult = await callEnricher(`${enricherUrl}/api/enrich/apply_start`, 'POST', applyPayload, 10000);

      if (startResult.ok && startResult.data) {
        const d = startResult.data as Record<string, unknown>;
        console.log('[import-normalize] Async apply started, apply_id:', d.apply_id);
        return new Response(
          JSON.stringify({ ok: true, apply_id: d.apply_id, status: d.status || 'PENDING' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Log why async failed
      if (startResult.data === null) {
        console.log(`[import-normalize] apply_start unavailable (status ${startResult.status}, non-JSON), falling back to sync`);
      } else {
        console.log(`[import-normalize] apply_start failed (status ${startResult.status}): ${JSON.stringify(startResult.data).substring(0, 200)}, falling back to sync`);
      }

      // Fallback to sync apply
      const syncResult = await callEnricher(`${enricherUrl}/api/enrich/apply`, 'POST', applyPayload);

      if (syncResult.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Apply timed out. The operation may still be running on the server. Try checking status later.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (syncResult.data === null) {
        return enricherErrorResponse(syncResult.status, syncResult.rawText, 'Apply returned non-JSON response');
      }
      if (!syncResult.ok) {
        const d = syncResult.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Apply failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[import-normalize] Sync apply OK');
      return new Response(
        JSON.stringify(syncResult.data),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle preview_rows
    // =========================================
    if (op === 'preview_rows') {
      const previewBody = body as PreviewRowsRequest;
      const previewPayload = {
        organization_id,
        import_job_id: previewBody.import_job_id || 'current',
        group_type: previewBody.group_type,
        filter_key: previewBody.filter_key,
        q: previewBody.q,
        limit: Math.min(previewBody.limit ?? 500, 2000),
        offset: previewBody.offset ?? 0,
      };

      const result = await callEnricher(`${enricherUrl}/api/enrich/preview_rows`, 'POST', previewPayload, 30000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Preview request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Preview returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Preview failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle chat
    // =========================================
    if (op === 'chat') {
      const chatBody = body as ChatRequest;
      if (!chatBody.message) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing message' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const chatPayload = {
        organization_id,
        import_job_id: chatBody.import_job_id || 'current',
        message: chatBody.message,
        context: chatBody.context || null,
      };

      const result = await callEnricher(`${enricherUrl}/api/enrich/chat`, 'POST', chatPayload, 45000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'AI request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Chat returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Chat failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle answer_question — user answers an AI question, then re-run is needed
    // =========================================
    if (op === 'answer_question') {
      const aqBody = body as AnswerQuestionRequest;
      if (!aqBody.question_type || !aqBody.token) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing question_type or token' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const aqPayload = {
        organization_id,
        import_job_id: aqBody.import_job_id || 'current',
        question_type: aqBody.question_type,
        token: aqBody.token,
        value: aqBody.value,
      };

      const result = await callEnricher(`${enricherUrl}/api/enrich/answer_question`, 'POST', aqPayload, 30000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Answer submission timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Answer returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Answer submission failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle stats
    // =========================================
    if (op === 'stats') {
      const statsPayload = {
        organization_id,
        import_job_id: import_job_id || 'current',
      };

      console.log(`[import-normalize] stats: org=${organization_id}`);

      const result = await callEnricher(`${enricherUrl}/api/enrich/stats`, 'POST', statsPayload, 30000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Stats request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Stats returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Stats failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle dashboard — KPI metrics + question cards
    // =========================================
    if (op === 'dashboard') {
      const dashBody = body as DashboardRequest;
      const dashPayload = {
        organization_id,
        import_job_id: dashBody.import_job_id || 'current',
      };

      console.log(`[import-normalize] dashboard: org=${organization_id}`);

      const result = await callEnricher(`${enricherUrl}/api/enrich/dashboard`, 'POST', dashPayload, 30000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Dashboard request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Dashboard returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Dashboard failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle tree — category tree navigation
    // =========================================
    if (op === 'tree') {
      const treeEndpoint = `${enricherUrl}/api/enrich/tree?organization_id=${encodeURIComponent(organization_id)}`;

      console.log(`[import-normalize] tree: org=${organization_id}`);

      const result = await callEnricher(treeEndpoint, 'GET', undefined, 20000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Tree request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Tree returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Tree failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle confirm — apply confirmed settings by type
    // =========================================
    if (op === 'confirm') {
      const confirmBody = body as ConfirmRequest;
      if (!confirmBody.type || !confirmBody.payload) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing type or payload for confirm' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const confirmPayload = {
        organization_id,
        import_job_id: confirmBody.import_job_id || 'current',
        type: confirmBody.type,
        payload: confirmBody.payload,
      };

      console.log(`[import-normalize] confirm: type=${confirmBody.type}, org=${organization_id}`);

      const result = await callEnricher(`${enricherUrl}/api/enrich/confirm`, 'POST', confirmPayload, 30000);

      if (result.timeout) {
        return new Response(
          JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Confirm request timed out.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Confirm returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: false, error: d.error || d.detail || 'Confirm failed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, ...result.data as Record<string, unknown> }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Unknown op
    return new Response(
      JSON.stringify({ ok: false, error: `Unknown op: ${op}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[import-normalize] Unhandled error:', message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
