import { describe, expect, it } from 'vitest';
import { normalizeApiError } from '@/lib/api/errors';

describe('normalizeApiError', () => {
  it('uses nested ApiEnvelope error payload with highest priority', () => {
    const result = normalizeApiError({
      ok: false,
      error: {
        code: 'X',
        message: 'boom',
        correlation_id: 'cid1',
      },
    });

    expect(result.code).toBe('X');
    expect(result.message).toBe('boom');
    expect(result.correlationId).toBe('cid1');
  });
});
