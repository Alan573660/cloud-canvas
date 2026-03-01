export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  status?: number;
  correlationId?: string;
}

export class ApiLayerError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiLayerError';
    this.code = shape.code;
    this.details = shape.details;
    this.status = shape.status;
    this.correlationId = shape.correlationId;
  }
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function normalizeApiError(error: unknown, fallbackMessage = 'Request failed'): ApiErrorShape {
  const obj = safeObject(error);

  const code =
    (obj?.code as string | undefined) ||
    (obj?.error_code as string | undefined) ||
    (obj?.name as string | undefined) ||
    'API_ERROR';

  const message =
    (obj?.message as string | undefined) ||
    (obj?.error as string | undefined) ||
    fallbackMessage;

  const status = typeof obj?.status === 'number' ? obj.status : undefined;
  const details = obj?.details ?? obj?.detail;
  const correlationId =
    (obj?.correlation_id as string | undefined) ||
    (obj?.correlationId as string | undefined);

  return { code, message, details, status, correlationId };
}

export function toApiLayerError(error: unknown, fallbackMessage?: string): ApiLayerError {
  return new ApiLayerError(normalizeApiError(error, fallbackMessage));
}
