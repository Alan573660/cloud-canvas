import type { ConfirmAction } from '@/lib/contract-types';

interface GuardIssue {
  index: number;
  type: string;
  reason: string;
}

export interface GuardResult {
  actions: ConfirmAction[];
  issues: GuardIssue[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWidthMasterPayload(payload: Record<string, unknown>): { payload: Record<string, unknown>; issue?: string } {
  const profile = asString(payload.profile) || asString(payload.token);

  if (!profile) {
    return { payload, issue: 'payload.profile is required for WIDTH_MASTER' };
  }

  return {
    payload: {
      ...payload,
      profile,
    },
  };
}

export function normalizeAndValidateConfirmActions(actions: ConfirmAction[]): GuardResult {
  const issues: GuardIssue[] = [];

  const normalized = actions.map((action, index) => {
    const type = String(action?.type || '').toUpperCase();
    const payload = asRecord(action?.payload);

    if (!type) {
      issues.push({ index, type: 'UNKNOWN', reason: 'action.type is required' });
      return { type: '', payload };
    }

    if (type === 'WIDTH_MASTER') {
      const widthResult = normalizeWidthMasterPayload(payload);
      if (widthResult.issue) {
        issues.push({ index, type, reason: widthResult.issue });
      }

      return {
        type,
        payload: widthResult.payload,
      };
    }

    return {
      type,
      payload,
    };
  });

  return { actions: normalized, issues };
}

export function hasInvalidConfirmActions(actions: ConfirmAction[]): boolean {
  return normalizeAndValidateConfirmActions(actions).issues.length > 0;
}
