import { supabase } from '@/integrations/supabase/client';
import { ApiLayerError, normalizeApiError, toApiLayerError } from '@/lib/api/errors';

export type ApiTransport = 'supabase-function' | 'fetch';

export interface ApiInvokeOptions<TBody = unknown> {
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TBody;
  headers?: Record<string, string>;
  transport?: ApiTransport;
  fetchUrl?: string;
  correlationId?: string;
}

export interface ApiInvokeSuccess<TData> {
  data: TData;
  correlationId: string;
}

function buildCorrelationId(explicitId?: string): string {
  if (explicitId) return explicitId;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildHeaders(correlationId: string, headers?: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'x-correlation-id': correlationId,
  };
}

export async function apiInvoke<TData = unknown, TBody = unknown>(
  options: ApiInvokeOptions<TBody>,
): Promise<ApiInvokeSuccess<TData>> {
  const correlationId = buildCorrelationId(options.correlationId);
  const method = options.method ?? 'POST';
  const headers = buildHeaders(correlationId, options.headers);
  const transport = options.transport ?? 'supabase-function';

  if (transport === 'fetch') {
    if (!options.fetchUrl) {
      throw toApiLayerError({
        code: 'FETCH_URL_REQUIRED',
        message: 'fetchUrl is required when transport is fetch',
        correlationId,
      });
    }

    let response: Response;
    try {
      response = await fetch(options.fetchUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw toApiLayerError({
        ...normalizeApiError(error, 'HTTP request failed'),
        correlationId,
      });
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch (error) {
      if (response.ok) {
        throw toApiLayerError({
          code: 'INVALID_JSON',
          message: 'Ответ сервера не JSON',
          details: normalizeApiError(error, 'JSON parse failed'),
          status: response.status,
          correlationId,
        });
      }
    }

    if (!response.ok) {
      const normalized = normalizeApiError(
        {
          ...(typeof json === 'object' && json !== null ? json : {}),
          status: response.status,
          correlationId,
        },
        `HTTP ${response.status}`,
      );
      throw new ApiLayerError(normalized);
    }

    if (json && typeof json === 'object' && 'ok' in json && (json as { ok?: boolean }).ok === false) {
      const normalized = normalizeApiError(json, 'Ошибка API (ok:false)');
      throw new ApiLayerError({ ...normalized, correlationId });
    }

    return { data: (json as TData) ?? ({} as TData), correlationId };
  }

  if (!options.endpoint) {
    throw toApiLayerError({
      code: 'ENDPOINT_REQUIRED',
      message: 'endpoint is required when transport is supabase-function',
      correlationId,
    });
  }

  const { data, error } = await supabase.functions.invoke<TData>(options.endpoint, {
    method,
    body: options.body,
    headers,
  });

  if (error) {
    const normalized = normalizeApiError(error, 'Edge function invocation failed');
    throw new ApiLayerError({ ...normalized, correlationId });
  }

  return { data: data as TData, correlationId };
}
