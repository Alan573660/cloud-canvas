/**
 * useNormalization — hook for all normalization backend calls.
 * 
 * Wraps: dry_run, apply (async), apply_status polling, stats, settings-merge.
 * All calls go through Supabase Edge Functions (import-normalize, settings-merge).
 * 
 * Security & stability features:
 * - Unified error parsing (422, 401, 5xx)
 * - PROFILE_HASH_MISMATCH auto-recovery
 * - Double-click protection for answer_question
 * - Polling limits (max 7 min / 300 requests)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { parseEdgeFunctionError, isHashMismatch } from '@/lib/edge-error-utils';

// ─── Types ────────────────────────────────────────────────────

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

export interface BackendQuestion {
  type: string;
  token?: string;
  profile?: string;
  examples?: string[];
  affected_count?: number;
  suggested?: unknown;
  suggested_variants?: unknown[];
  ask?: string;
  confidence?: number;
}

export interface DryRunResult {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
  };
  patches_sample?: DryRunPatch[];
  questions?: BackendQuestion[];
  error?: string;
  code?: string;
  recommended_limit?: number;
  // AI skip reason: set by backend when AI suggestions are skipped
  ai_skip_reason?: string;
  ai_disabled?: boolean;
}

export type ApplyState = 'IDLE' | 'STARTING' | 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | 'POLL_EXCEEDED';

export interface ApplyStatusResult {
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

// ─── Dashboard types from /api/enrich/dashboard ──────────────

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

// ─── Tree types from /api/enrich/tree ────────────────────────

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

// ─── Confirm types ───────────────────────────────────────────

export interface ConfirmResult {
  ok: boolean;
  type?: string;
  next_action?: string;
  affected_clusters?: string[];
  stats?: { updates: number; elapsed_ms: number };
  error?: string;
}

export interface ConfirmedSettings {
  widths_selected?: Record<string, { work_mm: number; full_mm: number }>;
  profile_aliases?: Record<string, string>;
  coatings?: Record<string, string>;
  colors?: {
    ral_aliases?: Record<string, string>;
    decor_aliases?: Record<string, { kind: string; label: string }>;
  };
}

// ─── Catalog item for UI display ──────────────────────────────

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

// ─── Polling constants ────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_DURATION_MS = 7 * 60 * 1000; // 7 minutes
const POLL_MAX_REQUESTS = 300;

// ─── Hook ─────────────────────────────────────────────────────

interface UseNormalizationOptions {
  organizationId: string;
  importJobId?: string;
}

export function useNormalization({ organizationId, importJobId }: UseNormalizationOptions) {
  // Dry run state
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // Catalog items loaded directly from DB
  const [catalogItems, setCatalogItems] = useState<CatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);

  // Apply state
  const [applyState, setApplyState] = useState<ApplyState>('IDLE');
  const [applyId, setApplyId] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyReport, setApplyReport] = useState<QualityMetrics | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Stats state
  const [statsLoading, setStatsLoading] = useState(false);
  const [serverStats, setServerStats] = useState<QualityMetrics | null>(null);

  // Dashboard state
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardResult, setDashboardResult] = useState<DashboardResult | null>(null);

  // Tree state
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeResult, setTreeResult] = useState<TreeResult | null>(null);

  // Confirm state
  const [confirmingType, setConfirmingType] = useState<string | null>(null);

  // Settings save
  const [savingSettings, setSavingSettings] = useState(false);

  // Answer question — with double-click lock
  const [answeringQuestion, setAnsweringQuestion] = useState(false);
  const answerLocksRef = useRef<Set<string>>(new Set());

  // Polling ref + counters
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const pollCountRef = useRef<number>(0);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ─── Dry Run ──────────────────────────────────────────────

  const executeDryRun = useCallback(async (options?: {
    limit?: number;
    aiSuggest?: boolean;
    sheetKinds?: string[];
    onlyWhereNull?: boolean;
  }) => {
    setDryRunLoading(true);
    setDryRunResult(null);
    setApplyState('IDLE');
    setApplyReport(null);
    setApplyError(null);

    try {
      const { data, error } = await supabase.functions.invoke<DryRunResult>('import-normalize', {
        body: {
          op: 'dry_run',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          scope: {
            only_where_null: options?.onlyWhereNull ?? false,
            limit: options?.limit ?? 2000,
            ...(options?.sheetKinds ? { sheet_kinds: options.sheetKinds } : {}),
          },
          ai_suggest: options?.aiSuggest ?? false,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as DryRunResult;

      if (!result?.ok) {
        if (result?.code === 'TIMEOUT') {
          toast({
            title: 'Таймаут',
            description: `Попробуйте уменьшить лимит до ${result.recommended_limit || 250}`,
            variant: 'destructive',
          });
        } else {
          throw new Error(parseEdgeFunctionError(null, result));
        }
        return null;
      }

      setRunId(result.run_id || null);
      setProfileHash(result.profile_hash || null);
      setDryRunResult(result);
      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка анализа', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setDryRunLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Save Confirmed Settings ──────────────────────────────

  const saveConfirmedSettings = useCallback(async (settings: ConfirmedSettings) => {
    setSavingSettings(true);
    try {
      const { data, error } = await supabase.functions.invoke('settings-merge', {
        body: {
          organization_id: organizationId,
          patch: {
            pricing: settings,
          },
        },
      });

      if (error) throw new Error(error.message);

      const result = data as { ok: boolean; error?: string };
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      toast({ title: 'Настройки сохранены', description: 'pricing.* обновлены через deep merge' });
      return true;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка сохранения', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setSavingSettings(false);
    }
  }, [organizationId]);

  // ─── Fetch Stats ──────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'stats',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
        },
      });

      if (error) throw new Error(error.message);

      const result = data as { ok: boolean; metrics?: QualityMetrics; error?: string };
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      if (result.metrics) {
        setServerStats(result.metrics);
      }
      return result.metrics || null;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка stats', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setStatsLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Fetch Dashboard ──────────────────────────────────────

  const fetchDashboard = useCallback(async (jobId?: string) => {
    setDashboardLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'dashboard',
          organization_id: organizationId,
          import_job_id: jobId || importJobId || 'current',
        },
      });

      if (error) throw new Error(error.message);

      const result = data as DashboardResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      setDashboardResult(result);
      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка загрузки дашборда', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setDashboardLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Fetch Tree ───────────────────────────────────────────

  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'tree',
          organization_id: organizationId,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as TreeResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      setTreeResult(result);
      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка загрузки дерева', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setTreeLoading(false);
    }
  }, [organizationId]);

  // ─── Confirm Question ─────────────────────────────────────

  const confirmQuestion = useCallback(async (type: string, payload: Record<string, unknown>, jobId?: string) => {
    setConfirmingType(type);
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'confirm',
          organization_id: organizationId,
          import_job_id: jobId || importJobId || 'current',
          type,
          payload,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as ConfirmResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      toast({ title: 'Правило сохранено', description: `${type}: затронуто ${result.affected_clusters?.length || 0} кластеров` });
      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка подтверждения', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setConfirmingType(null);
    }
  }, [organizationId, importJobId]);

  // ─── Apply ────────────────────────────────────────────────


  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
    pollStartRef.current = 0;
  }, []);

  const pollApplyStatus = useCallback(async (currentApplyId: string, currentRunId: string) => {
    // Check polling limits
    pollCountRef.current += 1;
    const elapsed = Date.now() - pollStartRef.current;

    if (elapsed > POLL_MAX_DURATION_MS || pollCountRef.current > POLL_MAX_REQUESTS) {
      setApplyState('POLL_EXCEEDED');
      setApplyError(
        `Polling превысил лимит (${Math.round(elapsed / 1000)}с / ${pollCountRef.current} запросов). ` +
        `Нажмите «Повторить» для проверки статуса.`
      );
      stopPolling();
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke<ApplyStatusResult>('import-normalize', {
        body: {
          op: 'apply_status',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          apply_id: currentApplyId,
          run_id: currentRunId,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as ApplyStatusResult;
      const state = result?.state?.toUpperCase();

      if (state === 'DONE') {
        setApplyState('DONE');
        setApplyProgress(100);
        if (result.report) {
          setApplyReport(result.report as unknown as QualityMetrics);
        }
        stopPolling();
        toast({ title: 'Нормализация завершена' });
      } else if (state === 'ERROR' || state === 'FAILED') {
        setApplyState('ERROR');
        setApplyError(parseEdgeFunctionError(null, result));
        stopPolling();
      } else {
        setApplyState('RUNNING');
        setApplyProgress(result.progress ?? 50);
      }
    } catch (err) {
      console.error('[polling] error:', err);
      // Don't stop polling on transient errors
    }
  }, [organizationId, importJobId, stopPolling]);

  const executeApply = useCallback(async () => {
    // Auto-run analysis if not done yet
    if (!runId || !profileHash) {
      toast({ title: 'Запускаем анализ…', description: 'Анализ будет выполнен автоматически перед применением' });
      const result = await executeDryRun({ aiSuggest: true, limit: 2000 });
      if (!result?.run_id) {
        toast({ title: 'Ошибка', description: 'Не удалось выполнить анализ. Попробуйте нажать «Сканировать».', variant: 'destructive' });
        return;
      }
      // Now proceed with fresh runId/profileHash from state — but we need to use them directly
      // since setState is async. Use the result values directly.
      const freshRunId = result.run_id;
      const freshHash = result.profile_hash;
      if (!freshRunId || !freshHash) {
        toast({ title: 'Ошибка', description: 'Анализ не вернул необходимые данные.', variant: 'destructive' });
        return;
      }
      // Call apply with fresh values
      await doApply(freshRunId, freshHash);
      return;
    }
    await doApply(runId, profileHash);
  }, [runId, profileHash, executeDryRun]);

  const doApply = useCallback(async (currentRunId: string, currentProfileHash: string) => {

    setApplyState('STARTING');
    setApplyError(null);
    setApplyReport(null);
    setApplyProgress(0);

    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
           op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: currentRunId,
          profile_hash: currentProfileHash,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as {
        ok?: boolean;
        apply_id?: string;
        status?: string;
        patched_rows?: number;
        error?: string;
        code?: string;
        error_code?: string;
      };

      // --- PROFILE_HASH_MISMATCH recovery ---
      if (isHashMismatch(result)) {
        toast({
          title: 'Настройки изменились',
          description: 'Автоматически пересканируем каталог…',
        });
        setApplyState('IDLE');
        // Auto-retry: re-run dry_run then user can re-apply
        const newResult = await executeDryRun({ aiSuggest: true, limit: 2000 });
        if (newResult) {
          toast({
            title: 'Пересканирование завершено',
            description: 'Нажмите «Применить» снова.',
          });
        } else {
          toast({
            title: 'Не удалось пересканировать',
            description: 'Попробуйте нажать «Сканировать» вручную.',
            variant: 'destructive',
          });
        }
        return;
      }

      if (result?.code === 'TIMEOUT') {
        setApplyState('ERROR');
        setApplyError('Таймаут. Попробуйте снова.');
        return;
      }

      if (result?.apply_id) {
        // Async mode — start polling with limits
        const newApplyId = result.apply_id;
        setApplyId(newApplyId);
        setApplyState('PENDING');
        pollStartRef.current = Date.now();
        pollCountRef.current = 0;

        pollingRef.current = setInterval(() => {
          pollApplyStatus(newApplyId, currentRunId);
        }, POLL_INTERVAL_MS);
      } else if (result?.ok !== false && result?.patched_rows !== undefined) {
        // Sync mode — done immediately
        setApplyState('DONE');
        setApplyProgress(100);
        toast({
          title: 'Готово',
          description: `Обновлено строк: ${result.patched_rows}`,
        });
      } else {
        throw new Error(parseEdgeFunctionError(null, result));
      }
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      setApplyState('ERROR');
      setApplyError(msg);
      toast({ title: 'Ошибка применения', description: msg, variant: 'destructive' });
    }
  }, [organizationId, importJobId, pollApplyStatus, executeDryRun]);

  // ─── Answer Question (with double-click protection) ────────

  const answerQuestion = useCallback(async (questionType: string, token: string, value: string | number) => {
    // Double-click lock: key = type + token
    const lockKey = `${questionType}:${token}`;
    if (answerLocksRef.current.has(lockKey)) {
      console.log(`[answerQuestion] Ignoring duplicate for ${lockKey}`);
      return false;
    }

    answerLocksRef.current.add(lockKey);
    setAnsweringQuestion(true);

    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'answer_question',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          question_type: questionType,
          token,
          value,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as { ok: boolean; error?: string; code?: string; error_code?: string };

      // Hash mismatch on answer → auto-retry dry_run
      if (isHashMismatch(result)) {
        toast({
          title: 'Настройки изменились',
          description: 'Пересканируем каталог…',
        });
        await executeDryRun({ aiSuggest: true, limit: 2000 });
        return false;
      }

      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      toast({ title: 'Ответ сохранён', description: `${questionType}: ${value}` });
      return true;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка отправки ответа', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setAnsweringQuestion(false);
      // Release lock after 500ms debounce
      setTimeout(() => {
        answerLocksRef.current.delete(lockKey);
      }, 500);
    }
  }, [organizationId, importJobId, executeDryRun]);

  // ─── Fetch Catalog Items via enricher preview_rows (BigQuery) ────────

  const fetchCatalogItems = useCallback(async (limit = 500) => {
    setCatalogLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'preview_rows',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          limit: Math.min(limit, 500),
          offset: 0,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as {
        ok: boolean;
        total_count?: number;
        rows?: CatalogRow[];
        error?: string;
      };

      if (!result?.ok) {
        // If enricher not available or catalog not in BQ yet, return empty silently
        console.warn('[fetchCatalogItems] preview_rows returned not ok:', result?.error);
        setCatalogItems([]);
        setCatalogTotal(0);
        return [];
      }

      const rows = (result.rows || []) as CatalogRow[];
      setCatalogTotal(result.total_count || rows.length);
      setCatalogItems(rows);
      return rows;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      console.warn('[fetchCatalogItems] preview_rows error (enricher may be unavailable):', msg);
      // Don't show destructive toast for background load — wizard still works with dry_run data
      setCatalogItems([]);
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Reset ────────────────────────────────────────────────

  const reset = useCallback(() => {
    setDryRunResult(null);
    setRunId(null);
    setProfileHash(null);
    setApplyState('IDLE');
    setApplyId(null);
    setApplyProgress(0);
    setApplyReport(null);
    setApplyError(null);
    setServerStats(null);
    setDashboardResult(null);
    setTreeResult(null);
    setCatalogItems([]);
    setCatalogTotal(0);
    answerLocksRef.current.clear();
    stopPolling();
  }, [stopPolling]);

  return {
    // Dry run
    dryRunLoading,
    dryRunResult,
    runId,
    profileHash,
    executeDryRun,

    // Catalog items
    catalogItems,
    catalogLoading,
    catalogTotal,
    fetchCatalogItems,

    // Apply
    applyState,
    applyId,
    applyProgress,
    applyReport,
    applyError,
    executeApply,

    // Stats
    statsLoading,
    serverStats,
    fetchStats,

    // Dashboard
    dashboardLoading,
    dashboardResult,
    fetchDashboard,

    // Tree
    treeLoading,
    treeResult,
    fetchTree,

    // Confirm question
    confirmingType,
    confirmQuestion,

    // Settings
    savingSettings,
    saveConfirmedSettings,

    // Answer question
    answeringQuestion,
    answerQuestion,

    // Utils
    reset,
  };
}

