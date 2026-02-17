/**
 * useNormalization — hook for all normalization backend calls.
 * 
 * Wraps: dry_run, apply (async), apply_status polling, stats, settings-merge.
 * All calls go through Supabase Edge Functions (import-normalize, settings-merge).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { fetchCatalogItems as fetchCatalogItemsFromAPI, type CatalogItem } from '@/lib/catalog-api';

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
  type: string;          // WIDTH_MASTER, COATING_MAP, COLOR_MAP, WIDTH_CONFIRM, etc.
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
}

export type ApplyState = 'IDLE' | 'STARTING' | 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';

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

  // Settings save
  const [savingSettings, setSavingSettings] = useState(false);

  // Answer question
  const [answeringQuestion, setAnsweringQuestion] = useState(false);

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          throw new Error(result?.error || 'Dry run failed');
        }
        return null;
      }

      setRunId(result.run_id || null);
      setProfileHash(result.profile_hash || null);
      setDryRunResult(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Ошибка dry_run', description: msg, variant: 'destructive' });
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
      if (!result?.ok) throw new Error(result?.error || 'Save failed');

      toast({ title: 'Настройки сохранены', description: 'pricing.* обновлены через deep merge' });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
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
      if (!result?.ok) throw new Error(result?.error || 'Stats fetch failed');

      if (result.metrics) {
        setServerStats(result.metrics);
      }
      return result.metrics || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Ошибка stats', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setStatsLoading(false);
    }
  }, [organizationId, importJobId]);

  // ─── Apply ────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollApplyStatus = useCallback(async (currentApplyId: string, currentRunId: string) => {
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
        setApplyError(result.error || 'Apply failed');
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
    if (!runId || !profileHash) {
      toast({ title: 'Ошибка', description: 'Сначала выполните Dry Run', variant: 'destructive' });
      return;
    }

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
      };

      if (result?.code === 'TIMEOUT') {
        setApplyState('ERROR');
        setApplyError('Таймаут. Попробуйте снова.');
        return;
      }

      if (result?.apply_id) {
        // Async mode — start polling with both ids
        const newApplyId = result.apply_id;
        setApplyId(newApplyId);
        setApplyState('PENDING');

        pollingRef.current = setInterval(() => {
          pollApplyStatus(newApplyId, runId);
        }, 3000);
      } else if (result?.ok !== false && result?.patched_rows !== undefined) {
        // Sync mode — done immediately
        setApplyState('DONE');
        setApplyProgress(100);
        toast({
          title: 'Готово',
          description: `Обновлено строк: ${result.patched_rows}`,
        });
      } else {
        throw new Error(result?.error || 'Apply failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setApplyState('ERROR');
      setApplyError(msg);
      toast({ title: 'Ошибка apply', description: msg, variant: 'destructive' });
    }
  }, [runId, profileHash, organizationId, importJobId, pollApplyStatus]);

  // ─── Answer Question ───────────────────────────────────────

  const answerQuestion = useCallback(async (questionType: string, token: string, value: string | number) => {
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

      const result = data as { ok: boolean; error?: string };
      if (!result?.ok) throw new Error(result?.error || 'Answer failed');

      toast({ title: 'Ответ сохранён', description: `${questionType}: ${value}` });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Ошибка отправки ответа', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setAnsweringQuestion(false);
    }
  }, [organizationId, importJobId]);

  // ─── Fetch Catalog Items ─────────────────────────────────

  const fetchCatalogItemsBQ = useCallback(async (limit = 5000) => {
    setCatalogLoading(true);
    try {
      // First get total count via facets or a small request
      const firstPage = await fetchCatalogItemsFromAPI({
        organization_id: organizationId,
        limit: 1,
        offset: 0,
      });
      const total = firstPage.total || 0;
      setCatalogTotal(total);

      const allItems: CatalogRow[] = [];
      const batchSize = 1000;
      const maxItems = Math.min(limit, total);
      
      for (let offset = 0; offset < maxItems; offset += batchSize) {
        const response = await fetchCatalogItemsFromAPI({
          organization_id: organizationId,
          limit: batchSize,
          offset,
        });

        if (response.items) {
          // Map BigQuery CatalogItem to CatalogRow format
          const mapped: CatalogRow[] = response.items.map(item => ({
            id: item.id,
            title: item.title,
            profile: null,
            thickness_mm: null,
            coating: null,
            notes: null,
            width_work_mm: null,
            width_full_mm: null,
            base_price_rub_m2: item.price_rub_m2 || 0,
            sku: null,
            extra_params: {
              cat_name: item.cat_name,
              cat_tree: item.cat_tree,
              unit: item.unit,
            },
          }));
          allItems.push(...mapped);
        }
        if (!response.items || response.items.length < batchSize) break;
      }

      setCatalogItems(allItems);
      return allItems;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Ошибка загрузки каталога', description: msg, variant: 'destructive' });
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }, [organizationId]);

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
    setCatalogItems([]);
    setCatalogTotal(0);
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
    fetchCatalogItems: fetchCatalogItemsBQ,

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
