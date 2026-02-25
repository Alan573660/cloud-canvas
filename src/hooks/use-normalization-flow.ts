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
  const [flowState, setFlowState] = useState<NormFlowState>('IDLE');
  const [lastError, setLastError] = useState<string | null>(null);

  // Derive flow state from norm hook state
  const derivedState = useMemo((): NormFlowState => {
    // Priority: explicit flowState overrides
    if (flowState === 'CONFIRMING') return 'CONFIRMING';

    // Apply states take precedence
    if (norm.applyState === 'STARTING' || norm.applyState === 'PENDING') return 'APPLY_STARTING';
    if (norm.applyState === 'RUNNING') return 'APPLY_RUNNING';
    if (norm.applyState === 'DONE') return 'APPLY_DONE';
    if (norm.applyState === 'ERROR' || norm.applyState === 'POLL_EXCEEDED') return 'ERROR';

    // Scanning
    if (norm.dryRunLoading) return 'SCANNING';

    // Questions available
    if (norm.dryRunResult?.questions && norm.dryRunResult.questions.length > 0) return 'QUESTIONS_OPEN';

    // Have results but no questions
    if (norm.dryRunResult) return 'QUESTIONS_OPEN'; // Still in workspace mode

    return flowState;
  }, [flowState, norm.applyState, norm.dryRunLoading, norm.dryRunResult]);

  // Context for UI
  const context = useMemo((): NormFlowContext => ({
    importJobId,
    runId: norm.runId,
    profileHash: norm.profileHash,
    applyId: norm.applyId,
    lastError: lastError || norm.applyError,
    questionsCount: norm.dryRunResult?.questions?.length || 0,
    patchesReady: norm.dryRunResult?.stats?.patches_ready || 0,
    totalScanned: norm.dryRunResult?.stats?.rows_scanned || norm.catalogTotal || 0,
  }), [importJobId, norm, lastError]);

  // ─── Actions ────────────────────────────────────────────

  const startScan = useCallback(async (options?: {
    limit?: number;
    aiSuggest?: boolean;
  }): Promise<DryRunResult | null> => {
    setFlowState('SCANNING');
    setLastError(null);
    const result = await norm.executeDryRun({
      aiSuggest: options?.aiSuggest ?? true,
      limit: options?.limit ?? 2000,
      onlyWhereNull: false,
    });
    if (!result) {
      setFlowState('ERROR');
    }
    // State will be derived from norm.dryRunResult
    return result;
  }, [norm]);

  const confirmBatch = useCallback(async (actions: ConfirmAction[]): Promise<ConfirmResult | null> => {
    setFlowState('CONFIRMING');
    const result = await norm.confirmActions(actions);
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
  }, [norm]);

  const startApply = useCallback(async () => {
    setFlowState('APPLY_STARTING');
    setLastError(null);
    await norm.executeApply();
  }, [norm]);

  const sendChat = useCallback(async (message: string, ctx?: Record<string, unknown>): Promise<AiChatV2Result | null> => {
    return norm.sendAiChatV2(message, ctx);
  }, [norm]);

  const resetFlow = useCallback(() => {
    setFlowState('IDLE');
    setLastError(null);
    norm.reset();
  }, [norm]);

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
