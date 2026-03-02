import { ApiErrorInfo, AnyRecord } from '@/lib/contract-types';

function sliceMessage(value: string, maxLength = 400): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export class ApiLayerError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly statusCode?: number;
  public readonly correlationId?: string;

  constructor(message: string, info: ApiErrorInfo) {
    super(message);
    this.name = 'ApiLayerError';
    this.code = info.code;
    this.details = info.details;
    this.statusCode = info.statusCode;
    this.correlationId = info.correlationId;
  }
}

export class ApiContractError extends ApiLayerError {
  constructor(message: string, info: ApiErrorInfo) {
    super(message, info);
    this.name = 'ApiContractError';
  }
}

export function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as { context?: { status?: number }; status?: number };

  if (typeof candidate.context?.status === 'number') {
    return candidate.context.status;
  }

  if (typeof candidate.status === 'number') {
    return candidate.status;
  }

  return null;
}

export function normalizeErrorFromData(data: AnyRecord, statusCode: number | null = null): ApiErrorInfo {
  const code = readString(data.code) || readString(data.error_code) || (statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : 'BUSINESS_ERROR');
  const message =
    readString(data.error) ||
    readString(data.message) ||
    readString(data.detail) ||
    'Unexpected business error';

  const details = data.detail ?? data.details ?? data;

  return {
    code,
    message: sliceMessage(message),
    details,
    statusCode: statusCode ?? undefined,
  };
}

export function normalizeInvokeError(
  error: unknown,
  data?: unknown,
  statusCode: number | null = null,
): ApiErrorInfo {
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as AnyRecord)
    : undefined;

  if (payload && payload.ok === false) {
    return normalizeErrorFromData(payload, statusCode);
  }

  const status = statusCode ?? extractStatusCode(error);
  if (status === 401 || status === 403) {
    return {
      code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
      message: status === 401 ? 'Unauthorized' : 'Access denied',
      details: payload ?? error,
      statusCode: status,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'NETWORK_ERROR',
      message: sliceMessage(error.message || 'Network error'),
      details: payload ?? error,
      statusCode: status ?? undefined,
    };
  }

  return {
    code: 'EDGE_INVOKE_ERROR',
    message: 'Edge function invocation failed',
    details: payload ?? error,
    statusCode: status ?? undefined,
  };
}

export function parseEdgeFunctionError(error: unknown, data?: unknown): string {
  return normalizeInvokeError(error, data).message;
}

export function isHashMismatch(result: { code?: string; error_code?: string } | null | undefined): boolean {
  return !!result && (result.code === 'PROFILE_HASH_MISMATCH' || result.error_code === 'PROFILE_HASH_MISMATCH');
}
