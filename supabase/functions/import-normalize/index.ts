import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Contract version tag for responses
const CONTRACT_VERSION = 'v1';

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
      contract_version: CONTRACT_VERSION,
      error: fallbackMsg,
      detail: `Enricher returned status ${status} with non-JSON body. Preview: ${preview}`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// =========================================
// normalizeQuestion — adapter for backward compat
// =========================================
function normalizeQuestion(q: Record<string, unknown>): Record<string, unknown> {
  return {
    ...q,
    // New fields first, fallback to legacy
    question_text: q.question_text || q.ask || '',
    affected_rows_count: q.affected_rows_count ?? q.affected_count ?? 0,
    suggested_actions: q.suggested_actions || q.suggested_variants || [],
    needs_user_confirmation: q.needs_user_confirmation ?? true,
    confidence: q.confidence ?? 0.5,
    // Keep legacy for backward compat
    ask: q.question_text || q.ask || '',
    affected_count: q.affected_rows_count ?? q.affected_count ?? 0,
    suggested_variants: q.suggested_actions || q.suggested_variants || [],
  };
}

// Normalize all questions in a response
function normalizeQuestions(data: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(data.questions)) {
    data.questions = (data.questions as Record<string, unknown>[]).map(normalizeQuestion);
  }
  return data;
}

// =========================================
// Request types
// =========================================

interface DryRunRequest {
  op: 'dry_run';
  organization_id: string;
  import_job_id: string;
  scope?: {
    only_where_null?: boolean;
    limit?: number;
    sheet_kind?: string;
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
  sheet_kind?: string;
  profile?: string;
  sort?: string;
  status?: 'needs_attention' | 'ready';
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

interface AiChatV2Request {
  op: 'ai_chat_v2';
  organization_id: string;
  import_job_id?: string;
  run_id?: string;
  message: string;
  context?: Record<string, unknown>;
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
  // Legacy single
  type?: string;
  payload?: Record<string, unknown>;
  // Contract v1 batch
  actions?: Array<{ type: string; payload: Record<string, unknown> }>;
}

type NormalizeRequest = DryRunRequest | ApplyRequest | ApplyStatusRequest | PreviewRowsRequest | ChatRequest | AiChatV2Request | AnswerQuestionRequest | StatsRequest | DashboardRequest | TreeRequest | ConfirmRequest;

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

    // Helper: JSON response with contract_version
    function jsonResponse(data: Record<string, unknown>, status = 200) {
      return new Response(
        JSON.stringify({ ...data, contract_version: CONTRACT_VERSION }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================
    // Handle apply_status
    // =========================================
    if (op === 'apply_status') {
      const statusBody = body as ApplyStatusRequest;
      const applyId = statusBody.apply_id || statusBody.run_id;
      if (!applyId) {
        return jsonResponse({ ok: false, error: 'Missing apply_id or run_id' }, 400);
      }

      const statusEndpoint = `${enricherUrl}/api/enrich/apply_status?import_job_id=${encodeURIComponent(import_job_id || 'current')}&apply_id=${encodeURIComponent(applyId)}&organization_id=${encodeURIComponent(organization_id)}`;
      console.log(`[import-normalize] Polling apply status: ${applyId}`);

      const result = await callEnricher(statusEndpoint, 'GET', undefined, 15000);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Status check timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Status check returned non-JSON');
      }
      if (!result.ok) {
        return jsonResponse({ ok: false, error: (result.data as Record<string, unknown>).error || 'Status check failed' });
      }

      // Normalize apply_status response to canonical fields
      const raw = result.data as Record<string, unknown>;
      const status = String(raw.status || raw.state || 'UNKNOWN').toUpperCase();
      const phase = String(raw.phase || 'unknown');
      const progressPercent = typeof raw.progress_percent === 'number' ? raw.progress_percent
        : typeof raw.progress === 'number' ? raw.progress : 0;
      const lastError = raw.last_error || raw.error || null;

      return jsonResponse({
        ...raw,
        ok: true,
        status,
        phase,
        progress_percent: progressPercent,
        last_error: lastError,
      });
    }

    // =========================================
    // Handle dry_run
    // =========================================
    if (op === 'dry_run') {
      const dryRunBody = body as DryRunRequest;
      const requestedScope = dryRunBody.scope || {} as Record<string, unknown>;
      const scopeLimit = typeof requestedScope.limit === 'number' ? requestedScope.limit : 0;
      const enricherPayload: Record<string, unknown> = {
        organization_id,
        import_job_id,
        scope: {
          only_where_null: requestedScope.only_where_null ?? true,
          limit: scopeLimit, // 0 = no limit (full dataset scan)
          ...(requestedScope.sheet_kind ? { sheet_kind: requestedScope.sheet_kind } : {}),
        },
        ai_suggest: dryRunBody.ai_suggest ?? false,
      };

      console.log(`[import-normalize] Calling dry_run, ai_suggest:`, enricherPayload.ai_suggest);

      const result = await callEnricher(`${enricherUrl}/api/enrich/dry_run`, 'POST', enricherPayload);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Enricher request timed out (55s). Retry with smaller limit.', recommended_limit: 250 });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Enricher dry_run returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Enricher request failed' });
      }

      // Normalize questions in response
      const normalized = normalizeQuestions(result.data as Record<string, unknown>);

      console.log('[import-normalize] dry_run OK, questions:', (normalized.questions as unknown[] | undefined)?.length || 0);
      return jsonResponse(normalized);
    }

    // =========================================
    // Handle apply — async first (apply_start), then sync fallback
    // =========================================
    if (op === 'apply') {
      const applyBody = body as ApplyRequest;
      if (!applyBody.run_id || !applyBody.profile_hash) {
        return jsonResponse({ ok: false, error: 'Missing run_id or profile_hash for apply' }, 400);
      }

      const applyPayload = {
        organization_id,
        import_job_id,
        run_id: applyBody.run_id,
        profile_hash: applyBody.profile_hash,
      };

      // Try async start first
      const startResult = await callEnricher(`${enricherUrl}/api/enrich/apply_start`, 'POST', applyPayload, 10000);

      if (startResult.ok && startResult.data) {
        const d = startResult.data as Record<string, unknown>;
        console.log('[import-normalize] Async apply started, apply_id:', d.apply_id);
        return jsonResponse({ ok: true, apply_id: d.apply_id, status: d.status || 'PENDING' });
      }

      if (startResult.data === null) {
        console.log(`[import-normalize] apply_start unavailable (status ${startResult.status}, non-JSON), falling back to sync`);
      } else {
        console.log(`[import-normalize] apply_start failed (status ${startResult.status}): ${JSON.stringify(startResult.data).substring(0, 200)}, falling back to sync`);
      }

      // Fallback to sync apply
      const syncResult = await callEnricher(`${enricherUrl}/api/enrich/apply`, 'POST', applyPayload);

      if (syncResult.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Apply timed out. The operation may still be running on the server.' });
      }
      if (syncResult.data === null) {
        return enricherErrorResponse(syncResult.status, syncResult.rawText, 'Apply returned non-JSON response');
      }
      if (!syncResult.ok) {
        const d = syncResult.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Apply failed' });
      }

      console.log('[import-normalize] Sync apply OK');
      return jsonResponse(syncResult.data as Record<string, unknown>);
    }

    // =========================================
    // Handle preview_rows
    // =========================================
    if (op === 'preview_rows') {
      const previewBody = body as PreviewRowsRequest;
      const previewPayload: Record<string, unknown> = {
        organization_id,
        import_job_id: previewBody.import_job_id || 'current',
        group_type: previewBody.group_type,
        filter_key: previewBody.filter_key,
        q: previewBody.q,
        limit: previewBody.limit ?? 500,
        offset: previewBody.offset ?? 0,
      };
      // Pass through Contract v1 filter fields
      if (previewBody.sheet_kind) previewPayload.sheet_kind = previewBody.sheet_kind;
      if (previewBody.profile) previewPayload.profile = previewBody.profile;
      if (previewBody.sort) previewPayload.sort = previewBody.sort;
      if (previewBody.status) previewPayload.status = previewBody.status;

      const result = await callEnricher(`${enricherUrl}/api/enrich/preview_rows`, 'POST', previewPayload, 30000);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Preview request timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Preview returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Preview failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
    }

    // =========================================
    // Handle ai_chat_v2 — Contract v1 AI Chat
    // =========================================
    if (op === 'ai_chat_v2') {
      const chatBody = body as AiChatV2Request;
      if (!chatBody.message) {
        return jsonResponse({ ok: false, error: 'Missing message' }, 400);
      }

      const chatPayload = {
        organization_id,
        import_job_id: chatBody.import_job_id || 'current',
        run_id: chatBody.run_id || null,
        message: chatBody.message,
        context: chatBody.context || null,
      };

      console.log(`[import-normalize] ai_chat_v2: msg="${chatBody.message.substring(0, 60)}"`);

      const result = await callEnricher(`${enricherUrl}/api/enrich/ai_chat_v2`, 'POST', chatPayload, 45000);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'AI request timed out.' });
      }

      // If ai_chat_v2 endpoint not available, fallback to legacy /chat
      if (!result.ok && (result.status === 404 || result.data === null)) {
        console.log('[import-normalize] ai_chat_v2 not found, falling back to legacy /chat');
        const legacyResult = await callEnricher(`${enricherUrl}/api/enrich/chat`, 'POST', {
          organization_id,
          import_job_id: chatBody.import_job_id || 'current',
          message: chatBody.message,
          context: chatBody.context || null,
        }, 45000);

        if (legacyResult.timeout) {
          return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'AI request timed out.' });
        }
        if (legacyResult.data === null) {
          return enricherErrorResponse(legacyResult.status, legacyResult.rawText, 'Chat returned non-JSON response');
        }
        if (!legacyResult.ok) {
          const d = legacyResult.data as Record<string, unknown>;
          return jsonResponse({ ok: false, error: d.error || d.detail || 'Chat failed' });
        }

        // Adapt legacy response to v1 contract: wrap singleton `action` into `actions[]`
        const legacyData = legacyResult.data as Record<string, unknown>;
        const actions: unknown[] = [];
        if (legacyData.action && typeof legacyData.action === 'object') {
          actions.push(legacyData.action);
        }
        if (Array.isArray(legacyData.actions)) {
          actions.push(...legacyData.actions);
        }

        return jsonResponse({
          ok: true,
          assistant_message: legacyData.reply || legacyData.answer || legacyData.message || '',
          actions,
          missing_fields: legacyData.missing_fields || [],
          requires_confirm: actions.length > 0,
          shadow_mode: legacyData.shadow_mode ?? false,
        });
      }

      if (result.data === null) {
        return jsonResponse({ ok: false, error: 'AI Chat v2 returned non-JSON response' });
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'AI Chat v2 failed' });
      }

      // Output guard: ensure actions[] is always an array
      const v2Data = result.data as Record<string, unknown>;
      const rawActions: unknown[] = [];
      if (Array.isArray(v2Data.actions)) {
        rawActions.push(...v2Data.actions);
      } else if (v2Data.action && typeof v2Data.action === 'object') {
        rawActions.push(v2Data.action);
      }
      // Validate each action has type+payload
      const validActions = rawActions.filter((a): a is Record<string, unknown> => {
        if (!a || typeof a !== 'object') return false;
        const act = a as Record<string, unknown>;
        return typeof act.type === 'string' && act.type.length > 0;
      }).map(a => ({
        type: String(a.type),
        payload: (a.payload && typeof a.payload === 'object') ? a.payload : {},
      }));

      const assistantMessage = String(v2Data.assistant_message || v2Data.reply || v2Data.message || '');

      return jsonResponse({
        ok: true,
        assistant_message: assistantMessage,
        actions: validActions,
        missing_fields: Array.isArray(v2Data.missing_fields) ? v2Data.missing_fields : [],
        requires_confirm: v2Data.requires_confirm ?? validActions.length > 0,
        shadow_mode: v2Data.shadow_mode ?? false,
      });
    }

    // =========================================
    // Handle legacy chat (kept for backward compat)
    // =========================================
    if (op === 'chat') {
      const chatBody = body as ChatRequest;
      if (!chatBody.message) {
        return jsonResponse({ ok: false, error: 'Missing message' }, 400);
      }

      const chatPayload = {
        organization_id,
        import_job_id: chatBody.import_job_id || 'current',
        message: chatBody.message,
        context: chatBody.context || null,
      };

      const result = await callEnricher(`${enricherUrl}/api/enrich/chat`, 'POST', chatPayload, 45000);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'AI request timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Chat returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Chat failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
    }

    // =========================================
    // Handle answer_question
    // =========================================
    if (op === 'answer_question') {
      const aqBody = body as AnswerQuestionRequest;
      if (!aqBody.question_type || !aqBody.token) {
        return jsonResponse({ ok: false, error: 'Missing question_type or token' }, 400);
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
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Answer submission timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Answer returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Answer submission failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
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
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Stats request timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Stats returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Stats failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
    }

    // =========================================
    // Handle dashboard
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
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Dashboard request timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Dashboard returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Dashboard failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
    }

    // =========================================
    // Handle tree
    // =========================================
    if (op === 'tree') {
      const treeEndpoint = `${enricherUrl}/api/enrich/tree?organization_id=${encodeURIComponent(organization_id)}`;

      console.log(`[import-normalize] tree: org=${organization_id}`);

      const result = await callEnricher(treeEndpoint, 'GET', undefined, 20000);

      if (result.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Tree request timed out.' });
      }
      if (result.data === null) {
        return enricherErrorResponse(result.status, result.rawText, 'Tree returned non-JSON response');
      }
      if (!result.ok) {
        const d = result.data as Record<string, unknown>;
        return jsonResponse({ ok: false, error: d.error || d.detail || 'Tree failed' });
      }

      return jsonResponse({ ok: true, ...result.data as Record<string, unknown> });
    }

    // =========================================
    // Handle confirm — supports batch actions[] (Contract v1)
    // =========================================
    if (op === 'confirm') {
      const confirmBody = body as ConfirmRequest;

      // Build actions array: support both batch and legacy single
      let actions: Array<{ type: string; payload: Record<string, unknown> }> = [];

      if (Array.isArray(confirmBody.actions) && confirmBody.actions.length > 0) {
        // Contract v1: batch actions
        actions = confirmBody.actions;
      } else if (confirmBody.type && confirmBody.payload) {
        // Legacy: single type+payload → wrap in array
        actions = [{ type: confirmBody.type, payload: confirmBody.payload }];
      } else {
        return jsonResponse({ ok: false, error: 'Missing type/payload or actions[] for confirm' }, 400);
      }

      console.log(`[import-normalize] confirm: ${actions.length} action(s), org=${organization_id}`);

      // Try batch endpoint first
      const batchPayload = {
        organization_id,
        import_job_id: confirmBody.import_job_id || 'current',
        actions,
      };

      const batchResult = await callEnricher(`${enricherUrl}/api/enrich/confirm`, 'POST', batchPayload, 30000);

      // If batch confirm works, return as-is
      if (batchResult.ok && batchResult.data) {
        const d = batchResult.data as Record<string, unknown>;
        // Output guard: validate confirm response structure
        const affectedClusters = Array.isArray(d.affected_clusters) ? d.affected_clusters : [];
        const applyStarted = typeof d.apply_started === 'boolean' ? d.apply_started : false;
        const applyId = typeof d.apply_id === 'string' ? d.apply_id : undefined;
        const stats = (d.stats && typeof d.stats === 'object') ? d.stats : { updates: actions.length };

        return jsonResponse({
          ok: true,
          type: 'BATCH',
          affected_clusters: affectedClusters,
          apply_started: applyStarted,
          apply_id: applyId,
          status_url: d.status_url,
          mode: d.mode || (applyId ? 'async' : 'sync'),
          stats,
          ...d,
        });
      }

      // If batch not supported (404), fall back to sequential single confirms
      if (batchResult.status === 404 || batchResult.data === null) {
        console.log('[import-normalize] Batch confirm not supported, falling back to sequential');
        let totalUpdates = 0;
        const allAffectedClusters: string[] = [];
        let lastApplyId: string | undefined;

        for (const action of actions) {
          const singlePayload = {
            organization_id,
            import_job_id: confirmBody.import_job_id || 'current',
            type: action.type,
            payload: action.payload,
          };

          const singleResult = await callEnricher(`${enricherUrl}/api/enrich/confirm`, 'POST', singlePayload, 30000);

          if (singleResult.ok && singleResult.data) {
            const sd = singleResult.data as Record<string, unknown>;
            totalUpdates++;
            if (Array.isArray(sd.affected_clusters)) {
              allAffectedClusters.push(...(sd.affected_clusters as string[]));
            }
            if (sd.apply_id) lastApplyId = sd.apply_id as string;
          } else {
            console.error(`[import-normalize] Single confirm failed for ${action.type}:`, singleResult.rawText?.substring(0, 200));
          }
        }

        return jsonResponse({
          ok: true,
          type: 'BATCH',
          affected_clusters: allAffectedClusters,
          apply_started: !!lastApplyId,
          apply_id: lastApplyId,
          mode: lastApplyId ? 'async' : 'sync',
          stats: { updates: totalUpdates, elapsed_ms: 0 },
        });
      }

      // Other errors from batch
      if (batchResult.timeout) {
        return jsonResponse({ ok: false, code: 'TIMEOUT', error: 'Confirm request timed out.' });
      }
      const d = (batchResult.data || {}) as Record<string, unknown>;
      return jsonResponse({ ok: false, error: d.error || d.detail || 'Confirm failed' });
    }

    // Unknown op
    return jsonResponse({ ok: false, error: `Unknown op: ${op}` }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[import-normalize] Unhandled error:', message);
    return new Response(
      JSON.stringify({ ok: false, contract_version: CONTRACT_VERSION, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
