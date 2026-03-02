import { supabase } from '@/integrations/supabase/client';
import {
  ApiErrorInfo,
  ApiInvokeOptions,
  ApiInvokeResult,
  ApiInvokeSuccess,
  AnyRecord,
  EdgeBaseResponse,
  InvokeHttpStatus,
} from '@/lib/contract-types';
import {
  ApiContractError,
  ApiLayerError,
  extractStatusCode,
  normalizeErrorFromData,
  normalizeInvokeError,
} from '@/lib/edge-error-utils';

function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const random = Math.random().toString(16).slice(2);
  return `cid-${Date.now()}-${random}`;
}

function asRecord(value: unknown): AnyRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as AnyRecord;
}

function getResponseStatus(error: unknown, data: unknown): InvokeHttpStatus {
  const statusFromError = extractStatusCode(error);
  if (statusFromError !== null) {
    return statusFromError;
  }

  const record = asRecord(data);
  const status = record?.status;
  return typeof status === 'number' ? status : null;
}

function buildErrorResult(
  correlationId: string,
  error: ApiErrorInfo,
): ApiInvokeResult<never> {
  return {
    ok: false,
    error,
    correlationId,
  };
}

function buildSuccessResult<TData>(
  correlationId: string,
  data: TData,
): ApiInvokeSuccess<TData> {
  return {
    ok: true,
    data,
    correlationId,
  };
}

export async function apiInvoke<
  TData = unknown,
  TPayload extends AnyRecord = AnyRecord,
>(
  functionName: string,
  payload: TPayload,
  options: ApiInvokeOptions = {},
): Promise<ApiInvokeResult<TData>> {
  const correlationId = options.correlationId ?? createCorrelationId();
  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
    ...(options.headers || {}),
  };

  try {
    const { data, error } = await supabase.functions.invoke<TData | EdgeBaseResponse>(functionName, {
      body: payload,
      headers,
    });

    const statusCode = getResponseStatus(error, data);

    if (error) {
      const normalized = normalizeInvokeError(error, data, statusCode);
      return buildErrorResult(correlationId, normalized);
    }

    const record = asRecord(data);

    if (record?.ok === false) {
      const normalized = normalizeErrorFromData(record, statusCode);
      return buildErrorResult(correlationId, normalized);
    }

    // 200 and 202 should be treated as success in compat layer.
    if (statusCode === 401 || statusCode === 403) {
      const authError: ApiErrorInfo = {
        code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        message: statusCode === 401 ? 'Unauthorized' : 'Access denied',
        details: { statusCode },
        statusCode,
      };
      return buildErrorResult(correlationId, authError);
    }

    return buildSuccessResult(correlationId, data as TData);
  } catch (err) {
    const normalized = normalizeInvokeError(err, undefined, null);
    return buildErrorResult(correlationId, normalized);
  }
}

export { ApiLayerError, ApiContractError };
export type { ApiInvokeResult, ApiInvokeOptions, ApiErrorInfo };

// Backward-compatible adapter for planned migration steps.
export async function invokeEdge<
  TData = unknown,
  TPayload extends AnyRecord = AnyRecord,
>(
  functionName: string,
  body: TPayload,
  options: ApiInvokeOptions = {},
): Promise<TData> {
  const result = await apiInvoke<TData, TPayload>(functionName, body, options);

  if (!result.ok) {
    throw new ApiLayerError(result.error.message, result.error);
  }

  return result.data;
}

export async function invokeNormalize<
  TData = unknown,
  TPayload extends AnyRecord = AnyRecord,
>(
  op: string,
  organizationId: string,
  params: TPayload = {} as TPayload,
  options: ApiInvokeOptions = {},
): Promise<ApiInvokeResult<TData>> {
  return apiInvoke<TData>('import-normalize', {
    op,
    organization_id: organizationId,
    ...params,
  }, options);
}

export function isHashMismatch(result: { code?: string; error_code?: string } | null | undefined): boolean {
  if (!result) return false;
  return result.code === 'PROFILE_HASH_MISMATCH' || result.error_code === 'PROFILE_HASH_MISMATCH';
}
