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
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { parseEdgeFunctionError, isHashMismatch } from '@/lib/edge-error-utils';

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
} from '@/lib/contract-types';

import { normalizeApplyStatus } from '@/lib/contract-types';

// ─── Polling constants ────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_DURATION_MS = 7 * 60 * 1000;
const POLL_MAX_REQUESTS = 300;
const POLL_MAX_CONSECUTIVE_ERRORS = 3;

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

  // Polling ref + counters
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const pollCountRef = useRef<number>(0);
  const pollErrorCountRef = useRef<number>(0);

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

  // ─── Confirm Question (legacy single) ─────────────────────

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

  // ─── Stop Polling ─────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
    pollStartRef.current = 0;
  }, []);

  // ─── Poll Apply Status (Contract v1: normalized fields) ───

  const pollApplyStatus = useCallback(async (currentApplyId: string, currentRunId: string) => {
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
        setApplyError(parseEdgeFunctionError(err));
        stopPolling();
      }
    }
  }, [organizationId, importJobId, stopPolling]);

  // ─── Start Polling Helper ─────────────────────────────────

  const startPolling = useCallback((newApplyId: string, rid: string) => {
    setApplyId(newApplyId);
    setApplyState('PENDING');
    setApplyPhase('unknown');
    pollStartRef.current = Date.now();
    pollCountRef.current = 0;
    pollErrorCountRef.current = 0;
    pollingRef.current = setInterval(() => {
      pollApplyStatus(newApplyId, rid);
    }, POLL_INTERVAL_MS);
  }, [pollApplyStatus]);

  // ─── Confirm Actions (Contract v1: batch) ─────────────────

  const confirmActions = useCallback(async (actions: ConfirmAction[], jobId?: string): Promise<ConfirmResult | null> => {
    if (actions.length === 0) return null;
    setConfirmingType('BATCH');
    try {
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'confirm',
          organization_id: organizationId,
          import_job_id: jobId || importJobId || 'current',
          actions,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as ConfirmResult;
      if (!result?.ok) throw new Error(parseEdgeFunctionError(null, result));

      toast({
        title: 'Правила применены',
        description: `${result.stats?.updates || actions.length} обновлений${result.apply_started ? ', применение запущено' : ''}`,
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
      const { data, error } = await supabase.functions.invoke<AiChatV2Result>('import-normalize', {
        body: {
          op: 'ai_chat_v2',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: runId,
          message,
          context,
        },
      });

      if (error) throw new Error(error.message);

      const result = data as AiChatV2Result;
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
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: runId,
          profile_hash: profileHash,
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
  };
}
