import { supabase } from '@/integrations/supabase/client';
import { ApiError, normalizeApiError } from '@/lib/api/errors';
import type { ApiBaseResponse } from '@/lib/api/contracts';

export interface ApiCallOptions {
  correlationId?: string;
  signal?: AbortSignal;
}

export interface EdgeInvokeOptions<TBody extends Record<string, unknown>> extends ApiCallOptions {
  body: TBody;
  headers?: Record<string, string>;
}

export interface HttpRequestOptions extends ApiCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getCorrelationId(id?: string): string {
  return id || createCorrelationId();
}

function assertBusinessOk<T extends ApiBaseResponse>(payload: T, correlationId: string): T {
  if (payload && payload.ok === false) {
    throw new ApiError({
      code: payload.code || payload.error_code || 'BUSINESS_ERROR',
      message: payload.error || payload.message || 'Business API error',
      details: payload.detail,
      correlationId: payload.correlation_id || correlationId,
      retryable: false,
    });
  }

  return payload;
}

/**
 * Unified Edge Function invoke wrapper.
 * Adds correlation_id to body and x-correlation-id header.
 */
export async function invokeEdge<TResponse extends ApiBaseResponse, TBody extends Record<string, unknown>>(
  functionName: string,
  options: EdgeInvokeOptions<TBody>
): Promise<TResponse> {
  const correlationId = getCorrelationId(options.correlationId);

  try {
    const { data, error } = await supabase.functions.invoke<TResponse>(functionName, {
      body: {
        ...options.body,
        correlation_id: correlationId,
      },
      headers: {
        'x-correlation-id': correlationId,
        ...(options.headers || {}),
      },
    });

    if (error) throw error;

    return assertBusinessOk((data || {}) as TResponse, correlationId);
  } catch (error) {
    const normalized = normalizeApiError(error, 'EDGE_INVOKE_ERROR');
    if (!normalized.correlationId) normalized.correlationId = correlationId;
    throw normalized;
  }
}

/**
 * Unified HTTP request wrapper for non-Supabase endpoints.
 */
export async function requestHttp<TResponse extends ApiBaseResponse>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<TResponse> {
  const correlationId = getCorrelationId(options.correlationId);

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': correlationId,
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify({
        ...(typeof options.body === 'object' && options.body !== null ? options.body as Record<string, unknown> : { value: options.body }),
        correlation_id: correlationId,
      }),
    });

    const payload = await res.json().catch(() => ({})) as TResponse;

    if (!res.ok) {
      throw new ApiError({
        code: payload.code || payload.error_code || `HTTP_${res.status}`,
        message: payload.error || payload.message || `HTTP error ${res.status}`,
        details: payload.detail,
        status: res.status,
        correlationId: payload.correlation_id || correlationId,
        retryable: [408, 429, 500, 502, 503, 504].includes(res.status),
      });
    }

    return assertBusinessOk(payload, correlationId);
  } catch (error) {
    const normalized = normalizeApiError(error, 'HTTP_REQUEST_ERROR');
    if (!normalized.correlationId) normalized.correlationId = correlationId;
    throw normalized;
  }
}
