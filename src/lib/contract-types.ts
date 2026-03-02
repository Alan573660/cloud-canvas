/**
 * Contract v1 — Canonical Types for Catalog Normalization
 * 
 * Single source of truth for frontend ↔ edge ↔ backend contract.
 * Imported by use-normalization hook and all UI components.
 */

// ─── Question Types ──────────────────────────────────────────

export type QuestionType =
  | 'WIDTH_MASTER'
  | 'COATING_MAP'
  | 'COLOR_MAP'
  | 'THICKNESS_SET'
  | 'PROFILE_MAP'
  | 'PRODUCT_KIND_MAP'
  | 'CATEGORY_FIX';

/** Contract v1 question with both new and legacy fields */
export interface BackendQuestion {
  type: string;
  token?: string;
  profile?: string;
  examples?: string[];
  // Contract v1 fields (primary)
  question_text?: string;
  affected_rows_count?: number;
  suggested_actions?: unknown[];
  needs_user_confirmation?: boolean;
  confidence?: number;
  // Legacy fields (backward compat — read only if v1 fields missing)
  affected_count?: number;
  suggested?: unknown;
  suggested_variants?: unknown[];
  ask?: string;
}

// ─── AI Status ───────────────────────────────────────────────

export interface AIStatus {
  enabled: boolean;
  attempted: boolean;
  failed: boolean;
  fail_reason?: string;
  model?: string;
}

// ─── Dry Run ─────────────────────────────────────────────────

export interface DryRunPatch {
  id: string;
  title?: string;
  profile?: string;
  thickness_mm?: number | string;
  coating?: string;
  color_code?: string;
  color_system?: string;
  width_work_mm?: number;
  width_full_mm?: number;
  price_rub_m2?: number;
  unit?: string;
  sheet_kind?: string;
  notes?: string;
  family_key?: string;
}

export interface DryRunResult {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
    ai_status?: AIStatus;
    // Legacy
    ai?: boolean;
    shadow_mode?: boolean;
  };
  patches_sample?: DryRunPatch[];
  questions?: BackendQuestion[];
  error?: string;
  code?: string;
  recommended_limit?: number;
  ai_skip_reason?: string;
  ai_disabled?: boolean;
  contract_version?: string;
}

// ─── Apply ───────────────────────────────────────────────────

export type ApplyState = 'IDLE' | 'STARTING' | 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | 'POLL_EXCEEDED';

/** Apply status response — Contract v1 canonical fields */
export interface ApplyStatusResult {
  // Contract v1 fields (primary)
  status?: string;           // QUEUED | RUNNING | DONE | FAILED | NOT_FOUND
  phase?: string;            // materialize | merge | done | unknown
  progress_percent?: number; // 0..100
  last_error?: string;
  // Legacy fields
  state?: string;
  progress?: number;
  report?: Record<string, number>;
  error?: string;
}

export interface QualityMetrics {
  total: number;
  profile_filled: number;
  width_work_filled: number;
  width_full_filled: number;
  color_system_filled: number;
  color_code_filled: number;
  coating_filled: number;
  kind_non_other: number;
  [key: string]: number;
}

// ─── Confirm ─────────────────────────────────────────────────

/** Single action for batch confirm */
export interface ConfirmAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface ConfirmResult {
  ok: boolean;
  type?: string;       // 'BATCH' for v1
  next_action?: string;
  affected_clusters?: string[];
  apply_started?: boolean;
  apply_id?: string;
  status_url?: string;
  mode?: string;       // 'sync' | 'async'
  stats?: { updates: number; elapsed_ms: number };
  apply_error?: string;
  error?: string;
}

// ─── AI Chat v2 ──────────────────────────────────────────────

export interface AiChatV2Action {
  type: string;
  payload: Record<string, unknown>;
}

export interface AiChatV2Result {
  ok: boolean;
  assistant_message: string;
  actions: AiChatV2Action[];
  missing_fields?: string[];
  requires_confirm?: boolean;
  shadow_mode?: boolean;
  error?: string;
  code?: string;
  ai_skip_reason?: string;
  ai_disabled?: boolean;
  contract_version?: string;
}

// ─── Dashboard ───────────────────────────────────────────────

export interface DashboardProgress {
  total: number;
  ready: number;
  needs_attention: number;
  ready_pct: number;
}

export interface DashboardQuestionCard {
  type: string;
  label: string;
  count: number;
  examples?: string[];
  priority?: number;
}

export interface DashboardResult {
  ok: boolean;
  organization_id?: string;
  import_job_id?: string;
  progress?: DashboardProgress;
  question_cards?: DashboardQuestionCard[];
  questions?: BackendQuestion[];
  tree?: Array<{
    sheet_kind: string;
    count: number;
    profiles?: Array<{ profile: string; count: number }>;
  }>;
  error?: string;
}

// ─── Tree ────────────────────────────────────────────────────

export interface TreeNode {
  cat_tree: string;
  cat_name: string;
  parts: string[];
  count: number;
}

export interface TreeResult {
  ok: boolean;
  organization_id?: string;
  nodes?: TreeNode[];
  error?: string;
}

// ─── Settings ────────────────────────────────────────────────

export interface ConfirmedSettings {
  widths_selected?: Record<string, { work_mm: number; full_mm: number }>;
  profile_aliases?: Record<string, string>;
  coatings?: Record<string, string>;
  colors?: {
    ral_aliases?: Record<string, string>;
    decor_aliases?: Record<string, { kind: string; label: string }>;
  };
}

// ─── Catalog Row ─────────────────────────────────────────────

export interface CatalogRow {
  id: string;
  title?: string | null;
  profile?: string | null;
  thickness_mm?: number | null;
  coating?: string | null;
  notes?: string | null;
  width_work_mm?: number | null;
  width_full_mm?: number | null;
  base_price_rub_m2?: number;
  sku?: string | null;
  extra_params?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Normalize apply status response to canonical fields.
 * Reads Contract v1 fields first, falls back to legacy.
 */
export function normalizeApplyStatus(result: ApplyStatusResult): {
  status: string;
  phase: string;
  progressPercent: number;
  lastError: string | null;
  report: Record<string, number> | null;
} {
  // Contract v1: status field is primary; legacy: state
  const status = (result.status || result.state || 'UNKNOWN').toUpperCase();
  const phase = result.phase || 'unknown';
  const progressPercent = result.progress_percent ?? result.progress ?? 0;
  const lastError = result.last_error || result.error || null;
  const report = result.report || null;

  return { status, phase, progressPercent, lastError, report };
}

// ─── API Layer Shim Types (PR1 compat) ──────────────────────

export type AnyRecord = Record<string, unknown>;

export type InvokeHttpStatus = number | null;

export interface ApiErrorInfo {
  code: string;
  message: string;
  details?: unknown;
  statusCode?: number;
  correlationId?: string;
}

export interface ApiInvokeSuccess<TData = unknown> {
  ok: true;
  data: TData;
  correlationId: string;
}

export interface ApiInvokeFailure {
  ok: false;
  error: ApiErrorInfo;
  correlationId: string;
}

export type ApiInvokeResult<TData = unknown> = ApiInvokeSuccess<TData> | ApiInvokeFailure;

export interface ApiInvokeOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  correlationId?: string;
}

export interface EdgeBaseResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  detail?: unknown;
  details?: unknown;
  code?: string;
  error_code?: string;
  status?: number;
}
