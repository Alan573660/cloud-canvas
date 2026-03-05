/**
 * useNormalization — hook for all normalization backend calls.
 * 
 * Contract v1: Unified types from contract-types.ts.
 * All calls go through Supabase Edge Functions (import-normalize, settings-merge).
 * 
 * Security & stability features:
 * - Unified error parsing (422, 401, 5xx)
 * - PROFILE_HASH_MISMATCH auto-recovery
 * - Double-click protection for answer_question
 * - Polling limits (max 7 min / 300 requests)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { parseEdgeFunctionError, isHashMismatch } from '@/lib/edge-error-utils';
import { apiInvoke } from '@/lib/api-client';
import { normalizeAndValidateConfirmActions } from '@/lib/confirm-action-guards';

// ─── Re-export all Contract v1 types from canonical source ────
export type {
  BackendQuestion,
  AIStatus,
  DryRunPatch,
  DryRunResult,
  ApplyState,
  ApplyStatusResult,
  QualityMetrics,
  ConfirmAction,
  ConfirmResult,
  AiChatV2Action,
  AiChatV2Result,
  ConfirmedSettings,
  CatalogRow,
  DashboardProgress,
  DashboardQuestionCard,
  DashboardResult,
  TreeNode,
  TreeResult,
} from '@/lib/contract-types';

import type {
  DryRunResult,
  ApplyState,
  ApplyStatusResult,
  QualityMetrics,
  ConfirmAction,
  ConfirmResult,
  AiChatV2Result,
  ConfirmedSettings,
  CatalogRow,
  DashboardResult,
  TreeResult,
  PreviewRowsResult,
  PreviewRowsFacets,
} from '@/lib/contract-types';

import { normalizeApplyStatus } from '@/lib/contract-types';

// ─── Polling constants ────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_DURATION_MS = 7 * 60 * 1000;
const POLL_MAX_REQUESTS = 300;
const POLL_MAX_CONSECUTIVE_ERRORS = 3;


async function invokeOrThrow<TData = unknown>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<TData> {
  const result = await apiInvoke<TData>(functionName, payload);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}


async function invokeWithEnvelope<TData = unknown>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<{ data: TData | null; envelope: TData | null; errorMessage: string | null }> {
  const result = await apiInvoke<TData>(functionName, payload);
  if (result.ok) {
    return { data: result.data, envelope: result.data, errorMessage: null };
  }

  const details = result.error.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const envelope = details as TData;
    return { data: null, envelope, errorMessage: result.error.message };
  }

  return { data: null, envelope: null, errorMessage: result.error.message };
}

// ─── Hook ─────────────────────────────────────────────────────

interface UseNormalizationOptions {
  organizationId: string;
  importJobId?: string;
}

export function useNormalization({ organizationId, importJobId }: UseNormalizationOptions) {
  // Dry run state
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // Catalog items loaded directly from enricher preview_rows
  const [catalogItems, setCatalogItems] = useState<CatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogFacets, setCatalogFacets] = useState<PreviewRowsFacets | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);

  // Apply state
  const [applyState, setApplyState] = useState<ApplyState>('IDLE');
  const [applyId, setApplyId] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyPhase, setApplyPhase] = useState<string>('unknown');
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

  // Polling ref + counters — single-flight lock via pollingApplyIdRef
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingApplyIdRef = useRef<string | null>(null); // single-flight: tracks which apply_id is being polled
  const pollStartRef = useRef<number>(0);
  const pollCountRef = useRef<number>(0);
  const pollErrorCountRef = useRef<number>(0);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingApplyIdRef.current = null;
    };
  }, []);

  // ─── Dry Run ──────────────────────────────────────────────

  const executeDryRun = useCallback(async (options?: {
    limit?: number;
    aiSuggest?: boolean;
    sheetKinds?: string[];
    sheetKind?: string;
    onlyWhereNull?: boolean;
  }) => {
    setDryRunLoading(true);
    setDryRunResult(null);
    setApplyState('IDLE');
    setApplyReport(null);
    setApplyError(null);

    try {
      const scopeObj: Record<string, unknown> = {
        only_where_null: options?.onlyWhereNull ?? false,
        limit: options?.limit ?? 0, // 0 = no limit (full dataset)
      };
      if (options?.sheetKind) {
        scopeObj.sheet_kind = options.sheetKind;
      } else if (options?.sheetKinds?.length) {
        scopeObj.sheet_kinds = options.sheetKinds;
      }

      const { data, envelope, errorMessage } = await invokeWithEnvelope<DryRunResult>('import-normalize', {
        op: 'dry_run',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        scope: scopeObj,
        ai_suggest: options?.aiSuggest ?? false,
      });

      const result = (data || envelope) as DryRunResult | null;

      if (!result) {
        throw new Error(errorMessage || 'Dry run failed');
      }

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
      const data = await invokeOrThrow<{ ok: boolean; error?: string }>('settings-merge', {
        organization_id: organizationId,
          patch: {
            pricing: settings,
          },
      });

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
      const data = await invokeOrThrow('import-normalize', {
        op: 'stats',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
      });

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
      const data = await invokeOrThrow('import-normalize', {
        op: 'dashboard',
        organization_id: organizationId,
        import_job_id: jobId || importJobId || 'current',
      });

      const result = data as DashboardResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      setDashboardResult(result);
      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      console.warn('[fetchDashboard] error (non-blocking):', msg);
      // Don't show toast for dashboard errors - it's non-critical
      return null;
    } finally {
      setDashboardLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Fetch Tree ───────────────────────────────────────────

  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const data = await invokeOrThrow('import-normalize', {
        op: 'tree',
        organization_id: organizationId,
      });

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

  // ─── Confirm Question (legacy single) ─────────────────────

  const confirmQuestion = useCallback(async (type: string, payload: Record<string, unknown>, jobId?: string) => {
    setConfirmingType(type);
    try {
      const data = await invokeOrThrow('import-normalize', {
        op: 'confirm',
        organization_id: organizationId,
        import_job_id: jobId || importJobId || 'current',
          type,
          payload,
      });

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

  // ─── Stop Polling ─────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollingApplyIdRef.current = null;
    pollCountRef.current = 0;
    pollStartRef.current = 0;
    pollErrorCountRef.current = 0;
  }, []);

  // ─── Poll Apply Status (Contract v1: normalized fields) ───

  const pollApplyStatus = useCallback(async (currentApplyId: string, currentRunId: string) => {
    if (!pollStartRef.current) {
      pollStartRef.current = Date.now();
    }

    pollCountRef.current += 1;
    const elapsed = pollStartRef.current > 0 ? Date.now() - pollStartRef.current : 0;

    if ((pollStartRef.current > 0 && elapsed > POLL_MAX_DURATION_MS) || pollCountRef.current > POLL_MAX_REQUESTS) {
      setApplyState('POLL_EXCEEDED');
      setApplyError(
        `Polling превысил лимит (${Math.round(elapsed / 1000)}с / ${pollCountRef.current} запросов). ` +
        `Нажмите «Повторить» для проверки статуса.`
      );
      stopPolling();
      return;
    }

    try {
      const data = await invokeOrThrow<ApplyStatusResult>('import-normalize', {
        op: 'apply_status',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        apply_id: currentApplyId,
        run_id: currentRunId,
      });

      const result = data as ApplyStatusResult;
      
      // Use canonical normalizer from contract-types
      const normalized = normalizeApplyStatus(result);
      const status = String(normalized.status).toUpperCase();

      pollErrorCountRef.current = 0;

      if (status === 'DONE' || status === 'COMPLETED') {
        setApplyState('DONE');
        setApplyProgress(100);
        setApplyPhase('done');
        if (normalized.report) {
          setApplyReport(normalized.report as unknown as QualityMetrics);
        }
        stopPolling();
        toast({ title: 'Нормализация завершена' });
      } else if (status === 'ERROR' || status === 'FAILED') {
        setApplyState('ERROR');
        setApplyError(normalized.lastError || 'Неизвестная ошибка');
        stopPolling();
      } else if (status === 'NOT_FOUND' || status === 'NOT_FOUND_FOR_APPLY_ID') {
        setApplyState('ERROR');
        setApplyError('Задача не найдена. Попробуйте запустить заново.');
        stopPolling();
      } else {
        // QUEUED or RUNNING
        setApplyState('RUNNING');
        setApplyProgress(normalized.progressPercent);
        setApplyPhase(normalized.phase);
      }
    } catch (err) {
      console.error('[polling] error:', err);
      pollErrorCountRef.current += 1;
      if (pollErrorCountRef.current >= POLL_MAX_CONSECUTIVE_ERRORS) {
        setApplyState('ERROR');
        const elapsedSec = Math.round((Date.now() - pollStartRef.current) / 1000);
        setApplyError(`[apply_status] ${parseEdgeFunctionError(err)} (после ${pollCountRef.current} запросов / ${elapsedSec}с)`);
        stopPolling();
      }
    }
  }, [organizationId, importJobId, stopPolling]);

  // ─── Start Polling Helper (single-flight: kills existing poll) ──

  const startPolling = useCallback((newApplyId: string, rid: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    setApplyId(newApplyId);
    setApplyState('PENDING');
    setApplyPhase('unknown');
    setApplyError(null);
    pollStartRef.current = Date.now();
    pollCountRef.current = 0;
    pollErrorCountRef.current = 0;

    // First check immediately (do not wait first interval tick)
    void pollApplyStatus(newApplyId, rid);

    pollingRef.current = setInterval(() => {
      // Single-flight: if apply_id changed between ticks, skip
      if (pollingApplyIdRef.current !== newApplyId) return;
      pollApplyStatus(newApplyId, rid);
    }, POLL_INTERVAL_MS);
  }, [pollApplyStatus]);

  // ─── Restart Polling (for "Повторить" button) ─────────────

  const restartPolling = useCallback(() => {
    const currentApplyId = applyId;
    const currentRunId = runId;
    if (currentApplyId && currentRunId) {
      console.log('[restartPolling] Restarting poll for apply_id:', currentApplyId);
      startPolling(currentApplyId, currentRunId);
    }
  }, [applyId, runId, startPolling]);

  // ─── Confirm Actions (Contract v1: batch) ─────────────────

  const confirmActions = useCallback(async (actions: ConfirmAction[], jobId?: string): Promise<ConfirmResult | null> => {
    if (actions.length === 0) return null;
    const guarded = normalizeAndValidateConfirmActions(actions);
    if (guarded.issues.length > 0) {
      const firstIssue = guarded.issues[0];
      toast({
        title: 'Неполное действие подтверждения',
        description: `${firstIssue.type}: ${firstIssue.reason}`,
        variant: 'destructive',
      });
      return null;
    }

    setConfirmingType('BATCH');
    try {
      const data = await invokeOrThrow('import-normalize', {
        op: 'confirm',
        organization_id: organizationId,
        import_job_id: jobId || importJobId || 'current',
          actions: guarded.actions,
      });

      const result = data as ConfirmResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      toast({
        title: 'Правила применены',
        description: `${result.stats?.updates || guarded.actions.length} обновлений${result.apply_started ? ', применение запущено' : ''}`,
      });

      // If apply was auto-started, begin polling
      if (result.apply_started && result.apply_id) {
        startPolling(result.apply_id, runId || '');
      }

      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      toast({ title: 'Ошибка подтверждения', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setConfirmingType(null);
    }
  }, [organizationId, importJobId, runId, startPolling]);

  // ─── AI Chat v2 (Contract v1) ─────────────────────────────

  const sendAiChatV2 = useCallback(async (message: string, context?: Record<string, unknown>): Promise<AiChatV2Result | null> => {
    try {
      const { data, envelope, errorMessage } = await invokeWithEnvelope<AiChatV2Result>('import-normalize', {
        op: 'ai_chat_v2',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        run_id: runId,
          message,
          context,
      });

      const result = (data || envelope) as AiChatV2Result | null;
      if (!result) {
        throw new Error(errorMessage || 'AI chat failed');
      }
      if (!result?.ok) {
        return result; // Return error for UI to handle
      }

      return result;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      return {
        ok: false,
        assistant_message: '',
        actions: [],
        error: msg,
      };
    }
  }, [organizationId, importJobId, runId]);

  // ─── Apply ────────────────────────────────────────────────

  const executeApply = useCallback(async () => {
    if (!runId || !profileHash) {
      toast({ title: 'Ошибка', description: 'Сначала выполните анализ', variant: 'destructive' });
      return;
    }

    setApplyState('STARTING');
    setApplyError(null);
    setApplyReport(null);
    setApplyProgress(0);
    setApplyPhase('unknown');

    try {
      const { data, envelope, errorMessage } = await invokeWithEnvelope<{
        ok?: boolean;
        apply_id?: string;
        status?: string;
        patched_rows?: number;
        error?: string;
        code?: string;
        error_code?: string;
      }>('import-normalize', {
        op: 'apply',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        run_id: runId,
        profile_hash: profileHash,
      });

      const result = (data || envelope);

      if (!result) {
        throw new Error(errorMessage || 'Apply failed');
      }

      if (isHashMismatch(result)) {
        toast({
          title: 'Настройки изменились',
          description: 'Автоматически пересканируем каталог…',
        });
        setApplyState('IDLE');
        const newResult = await executeDryRun({ aiSuggest: true, limit: 2000 });
        if (newResult) {
          toast({ title: 'Пересканирование завершено', description: 'Нажмите «Применить» снова.' });
        } else {
          toast({ title: 'Не удалось пересканировать', description: 'Попробуйте нажать «Сканировать» вручную.', variant: 'destructive' });
        }
        return;
      }

      if (result?.code === 'TIMEOUT') {
        setApplyState('ERROR');
        setApplyError('Таймаут. Попробуйте снова.');
        return;
      }

      if (result?.apply_id) {
        startPolling(result.apply_id, runId);
      } else if (result?.ok !== false && result?.patched_rows !== undefined) {
        setApplyState('DONE');
        setApplyProgress(100);
        toast({ title: 'Готово', description: `Обновлено строк: ${result.patched_rows}` });
      } else {
        throw new Error(parseEdgeFunctionError(null, result));
      }
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      setApplyState('ERROR');
      setApplyError(msg);
      toast({ title: 'Ошибка применения', description: msg, variant: 'destructive' });
    }
  }, [runId, profileHash, organizationId, importJobId, startPolling, executeDryRun]);

  // ─── Answer Question (legacy — with double-click protection) ─

  const answerQuestion = useCallback(async (questionType: string, token: string, value: string | number) => {
    const lockKey = `${questionType}:${token}`;
    if (answerLocksRef.current.has(lockKey)) {
      console.log(`[answerQuestion] Ignoring duplicate for ${lockKey}`);
      return false;
    }

    answerLocksRef.current.add(lockKey);
    setAnsweringQuestion(true);

    try {
      const { data, envelope, errorMessage } = await invokeWithEnvelope<
        { ok: boolean; error?: string; code?: string; error_code?: string }
      >('import-normalize', {
        op: 'answer_question',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        question_type: questionType,
        token,
        value,
      });

      const result = (data || envelope);

      if (!result) {
        throw new Error(errorMessage || 'Answer failed');
      }

      if (isHashMismatch(result)) {
        toast({ title: 'Настройки изменились', description: 'Пересканируем каталог…' });
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
      setTimeout(() => {
        answerLocksRef.current.delete(lockKey);
      }, 500);
    }
  }, [organizationId, importJobId, executeDryRun]);

  // ─── Fetch Catalog Items via enricher preview_rows ─────────

  const fetchCatalogItems = useCallback(async (limit = 2000, filters?: {
    sheetKind?: string;
    profile?: string;
    sort?: string;
    q?: string;
  }) => {
    setCatalogLoading(true);
    try {
      // Fetch in batches to overcome backend row limits
      const batchSize = 500;
      const maxRows = Math.min(limit, 10000);
      let allRows: CatalogRow[] = [];
      let totalCount = 0;
      let offset = 0;
      let hasMore = true;
      let facets: PreviewRowsFacets | null = null;

      while (hasMore && allRows.length < maxRows) {
        const currentBatch = Math.min(batchSize, maxRows - allRows.length);
        const payload: Record<string, unknown> = {
          op: 'preview_rows',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          limit: currentBatch,
          offset,
        };
        if (filters?.sheetKind) payload.sheet_kind = filters.sheetKind;
        if (filters?.profile) payload.profile = filters.profile;
        if (filters?.sort) payload.sort = filters.sort;
        if (filters?.q) payload.q = filters.q;

        const data = await invokeOrThrow('import-normalize', payload);

        const result = data as PreviewRowsResult;

        if (!result?.ok) {
          console.warn('[fetchCatalogItems] preview_rows returned not ok:', result?.error);
          break;
        }

        const rows = (result.rows || []) as CatalogRow[];
        totalCount = result.total_count || totalCount;
        allRows = [...allRows, ...rows];
        offset += rows.length;
        hasMore = (result.has_next !== undefined ? result.has_next : rows.length === currentBatch) && allRows.length < maxRows;

        // Capture facets from first batch response
        if (!facets && result.facets) {
          facets = result.facets;
        }
      }

      setCatalogTotal(totalCount || allRows.length);
      setCatalogItems(allRows);
      setCatalogFacets(facets);
      return allRows;
    } catch (err) {
      const msg = parseEdgeFunctionError(err);
      console.warn('[fetchCatalogItems] preview_rows error:', msg);
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
    setApplyPhase('unknown');
    setApplyReport(null);
    setApplyError(null);
    setServerStats(null);
    setDashboardResult(null);
    setTreeResult(null);
    setCatalogItems([]);
    setCatalogTotal(0);
    setCatalogFacets(null);
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
    catalogFacets,
    fetchCatalogItems,

    // Apply
    applyState,
    applyId,
    applyProgress,
    applyPhase,
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

    // Confirm (legacy single)
    confirmingType,
    confirmQuestion,

    // Confirm (Contract v1: batch)
    confirmActions,

    // AI Chat v2
    sendAiChatV2,

    // Settings
    savingSettings,
    saveConfirmedSettings,

    // Answer question (legacy)
    answeringQuestion,
    answerQuestion,

    // Utils
    reset,
    restartPolling,
  };
}
