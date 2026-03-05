/**
 * useNormalizationFlow — centralized state machine for normalization lifecycle.
 * 
 * States: IDLE -> SCANNING -> QUESTIONS_OPEN -> CONFIRMING -> APPLYING -> DONE | ERROR
 * 
 * Wraps useNormalization hook with explicit flow states and recovery.
 */

import { useState, useCallback, useMemo } from 'react';
import { useNormalization } from './use-normalization';
import type { DryRunResult, ConfirmAction, ConfirmResult, AiChatV2Result } from '@/lib/contract-types';

// ─── Flow States ─────────────────────────────────────────────

export type NormFlowState =
  | 'IDLE'
  | 'SCANNING'
  | 'QUESTIONS_OPEN'
  | 'CONFIRMING'
  | 'APPLY_STARTING'
  | 'APPLY_RUNNING'
  | 'APPLY_DONE'
  | 'ERROR';

export interface NormFlowContext {
  importJobId?: string;
  runId: string | null;
  profileHash: string | null;
  applyId: string | null;
  lastError: string | null;
  questionsCount: number;
  patchesReady: number;
  totalScanned: number;
}

// ─── Hook ────────────────────────────────────────────────────

interface UseNormalizationFlowOptions {
  organizationId: string;
  importJobId?: string;
}

export function useNormalizationFlow({ organizationId, importJobId }: UseNormalizationFlowOptions) {
  const norm = useNormalization({ organizationId, importJobId });
  const {
    applyState,
    dryRunLoading,
    dryRunResult,
    runId,
    profileHash,
    applyId,
    applyError,
    catalogTotal,
    executeDryRun,
    confirmActions,
    executeApply,
    sendAiChatV2,
    reset,
  } = norm;

  const [flowState, setFlowState] = useState<NormFlowState>('IDLE');
  const [lastError, setLastError] = useState<string | null>(null);

  // Derive flow state from norm hook state
  const derivedState = useMemo((): NormFlowState => {
    // Priority: explicit flowState overrides
    if (flowState === 'CONFIRMING') return 'CONFIRMING';

    // Apply states take precedence
    if (applyState === 'STARTING' || applyState === 'PENDING') return 'APPLY_STARTING';
    if (applyState === 'RUNNING') return 'APPLY_RUNNING';
    if (applyState === 'DONE') return 'APPLY_DONE';
    if (applyState === 'ERROR' || applyState === 'POLL_EXCEEDED') return 'ERROR';

    // Scanning
    if (dryRunLoading) return 'SCANNING';

    // Questions available
    if (dryRunResult?.questions && dryRunResult.questions.length > 0) return 'QUESTIONS_OPEN';

    // Have results but no questions
    if (dryRunResult) return 'QUESTIONS_OPEN'; // Still in workspace mode

    return flowState;
  }, [flowState, applyState, dryRunLoading, dryRunResult]);

  // Context for UI
  const context = useMemo((): NormFlowContext => ({
    importJobId,
    runId,
    profileHash,
    applyId,
    lastError: lastError || applyError,
    questionsCount: dryRunResult?.questions?.length || 0,
    patchesReady: dryRunResult?.stats?.patches_ready || 0,
    totalScanned: dryRunResult?.stats?.rows_total || dryRunResult?.stats?.rows_scanned || catalogTotal || 0,
  }), [importJobId, runId, profileHash, applyId, lastError, applyError, dryRunResult, catalogTotal]);

  // ─── Actions ────────────────────────────────────────────

  const startScan = useCallback(async (options?: {
    limit?: number;
    aiSuggest?: boolean;
    sheetKind?: string;
  }): Promise<DryRunResult | null> => {
    setFlowState('SCANNING');
    setLastError(null);
    const result = await executeDryRun({
      aiSuggest: options?.aiSuggest ?? true,
      limit: options?.limit ?? 0, // 0 = full dataset
      onlyWhereNull: false,
      sheetKind: options?.sheetKind,
    });
    if (!result) {
      setFlowState('ERROR');
    }
    // State will be derived from norm.dryRunResult
    return result;
  }, [executeDryRun]);

  const confirmBatch = useCallback(async (actions: ConfirmAction[]): Promise<ConfirmResult | null> => {
    setFlowState('CONFIRMING');
    const result = await confirmActions(actions);
    if (!result?.ok) {
      setFlowState('ERROR');
    } else {
      // If apply was auto-started, state will be derived from applyState
      // Otherwise go back to questions
      if (!result.apply_started) {
        setFlowState('QUESTIONS_OPEN');
      }
    }
    return result;
  }, [confirmActions]);

  const startApply = useCallback(async () => {
    setFlowState('APPLY_STARTING');
    setLastError(null);
    await executeApply();
  }, [executeApply]);

  const sendChat = useCallback(async (message: string, ctx?: Record<string, unknown>): Promise<AiChatV2Result | null> => {
    return sendAiChatV2(message, ctx);
  }, [sendAiChatV2]);

  const resetFlow = useCallback(() => {
    setFlowState('IDLE');
    setLastError(null);
    reset();
  }, [reset]);

  return {
    // State
    state: derivedState,
    context,
    
    // Raw norm hook (for direct access when needed)
    norm,

    // Flow actions
    startScan,
    confirmBatch,
    startApply,
    sendChat,
    resetFlow,
  };
}
