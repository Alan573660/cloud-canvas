export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  status?: number;
  correlationId?: string;
  retryable: boolean;
}

export class ApiError extends Error {
  code: string;
  details?: unknown;
  status?: number;
  correlationId?: string;
  retryable: boolean;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.code = shape.code;
    this.details = shape.details;
    this.status = shape.status;
    this.correlationId = shape.correlationId;
    this.retryable = shape.retryable;
  }
}

function parseStatus(message: string): number | undefined {
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function isRetryableStatus(status?: number): boolean {
  return !!status && [408, 429, 500, 502, 503, 504].includes(status);
}

export function normalizeApiError(error: unknown, fallbackCode = 'API_ERROR'): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof Error) {
    const status = parseStatus(error.message);
    return new ApiError({
      code: fallbackCode,
      message: error.message || 'Unknown API error',
      status,
      retryable: isRetryableStatus(status),
    });
  }

  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const message = String(e.message || e.error || 'Unknown API error');
    const status = typeof e.status === 'number' ? e.status : parseStatus(message);

    return new ApiError({
      code: String(e.code || e.error_code || fallbackCode),
      message,
      details: e.detail || e.details,
      status,
      correlationId: typeof e.correlation_id === 'string' ? e.correlation_id : undefined,
      retryable: isRetryableStatus(status),
    });
  }

  return new ApiError({
    code: fallbackCode,
    message: typeof error === 'string' ? error : 'Unknown API error',
    retryable: false,
  });
}
