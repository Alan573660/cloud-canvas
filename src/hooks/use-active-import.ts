import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'active_import_job_id';
const POLL_INTERVAL = 3000; // 3 seconds

export interface ActiveImportJob {
  id: string;
  status: string;
  file_name: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  inserted_rows: number;
  updated_rows: number;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

const FINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];
const IN_PROGRESS_STATUSES = ['QUEUED', 'VALIDATING', 'VALIDATED', 'APPLYING'];

export function useActiveImportJob() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  
  const [activeJobId, setActiveJobIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // Sync with localStorage
  const setActiveJobId = useCallback((jobId: string | null) => {
    setActiveJobIdState(jobId);
    if (jobId) {
      localStorage.setItem(STORAGE_KEY, jobId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Clear on final status
  const clearActiveJob = useCallback(() => {
    setActiveJobId(null);
    queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['catalog-stats-import'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }, [setActiveJobId, queryClient]);

  // Query for active job with polling
  const { data: activeJob, isLoading, error } = useQuery({
    queryKey: ['active-import-job', activeJobId],
    queryFn: async () => {
      if (!activeJobId || !profile?.organization_id) return null;

      const { data, error } = await supabase
        .from('import_jobs')
        .select('id, status, file_name, total_rows, valid_rows, invalid_rows, inserted_rows, updated_rows, error_message, created_at, finished_at')
        .eq('id', activeJobId)
        .eq('organization_id', profile.organization_id)
        .single();

      if (error) {
        console.error('[useActiveImportJob] Error fetching job:', error);
        // Clear if job not found
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as ActiveImportJob;
    },
    enabled: !!activeJobId && !!profile?.organization_id,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll only if job is in progress
      if (data && IN_PROGRESS_STATUSES.includes(data.status)) {
        return POLL_INTERVAL;
      }
      return false;
    },
    staleTime: 1000,
  });

  // Auto-clear when job reaches final status
  useEffect(() => {
    if (activeJob && FINAL_STATUSES.includes(activeJob.status)) {
      // Delay clear to allow UI to show final state
      const timer = setTimeout(() => {
        clearActiveJob();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeJob, clearActiveJob]);

  // Check if job is in progress
  const isInProgress = activeJob ? IN_PROGRESS_STATUSES.includes(activeJob.status) : false;
  const isCompleted = activeJob?.status === 'COMPLETED';
  const isFailed = activeJob?.status === 'FAILED';

  // Get step info for UI
  const getStepInfo = useCallback(() => {
    if (!activeJob) return null;

    const steps = [
      { key: 'QUEUED', label: 'Подготовка' },
      { key: 'VALIDATING', label: 'Проверка' },
      { key: 'VALIDATED', label: 'Проверено' },
      { key: 'APPLYING', label: 'Применение' },
      { key: 'COMPLETED', label: 'Завершено' },
    ];

    const currentIdx = steps.findIndex(s => s.key === activeJob.status);
    const progress = currentIdx >= 0 ? ((currentIdx + 1) / steps.length) * 100 : 0;

    return {
      steps,
      currentStep: activeJob.status,
      currentIdx,
      progress,
    };
  }, [activeJob]);

  return {
    activeJobId,
    activeJob,
    isLoading,
    error,
    isInProgress,
    isCompleted,
    isFailed,
    setActiveJobId,
    clearActiveJob,
    getStepInfo,
  };
}
