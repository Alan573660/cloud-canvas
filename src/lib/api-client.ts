/**
 * Unified API Client for Edge Function calls.
 * 
 * Features:
 * - Mandatory organization_id injection
 * - Typed error class (ApiContractError)
 * - Normalized error parsing from edge/backend responses
 * - Single import point for all edge invocations
 */

import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError, isHashMismatch } from '@/lib/edge-error-utils';

// ─── Error Class ─────────────────────────────────────────────

export class ApiContractError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isRetryable: boolean;
  public readonly detail: unknown;

  constructor(opts: {
    message: string;
    code?: string;
    statusCode?: number;
    isRetryable?: boolean;
    detail?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiContractError';
    this.code = opts.code || 'UNKNOWN';
    this.statusCode = opts.statusCode || 0;
    this.isRetryable = opts.isRetryable ?? false;
    this.detail = opts.detail;
  }
}

// ─── Response Shape ──────────────────────────────────────────

interface BaseResponse {
  ok?: boolean;
  error?: string;
  detail?: unknown;
  code?: string;
  error_code?: string;
}

// ─── Core Invoke ─────────────────────────────────────────────

/**
 * Invoke a Supabase Edge Function with mandatory organization_id.
 * Parses errors into ApiContractError.
 */
export async function invokeEdge<T extends BaseResponse>(
  functionName: string,
  body: Record<string, unknown> & { organization_id: string },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(functionName, { body });

  if (error) {
    throw new ApiContractError({
      message: parseEdgeFunctionError(error, data),
      code: 'EDGE_INVOKE_ERROR',
      isRetryable: true,
    });
  }

  const result = data as T;

  if (result && result.ok === false) {
    const code = result.code || result.error_code || 'BUSINESS_ERROR';
    const isTimeout = code === 'TIMEOUT';
    const isAuth = code === '401' || code === '403';

    throw new ApiContractError({
      message: parseEdgeFunctionError(null, result),
      code,
      isRetryable: isTimeout,
      statusCode: isAuth ? parseInt(code) : 0,
      detail: result.detail,
    });
  }

  return result;
}

/**
 * Invoke import-normalize edge function with a specific operation.
 */
export async function invokeNormalize<T extends BaseResponse>(
  op: string,
  organizationId: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invokeEdge<T>('import-normalize', {
    op,
    organization_id: organizationId,
    ...params,
  });
}

// ─── Re-exports for convenience ──────────────────────────────

export { parseEdgeFunctionError, isHashMismatch };
