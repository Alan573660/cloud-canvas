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

function safeMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

export function normalizeApiError(error: unknown, fallbackMessage = 'Request failed'): ApiErrorShape {
  const obj = safeObject(error);
  const nested = safeObject(obj?.error);

  const code =
    (typeof nested?.code === 'string' ? nested.code : undefined) ||
    (typeof obj?.code === 'string' ? obj.code : undefined) ||
    (typeof obj?.error_code === 'string' ? obj.error_code : undefined) ||
    (typeof obj?.name === 'string' ? obj.name : undefined) ||
    'API_ERROR';

  const message =
    safeMessage(nested?.message) ||
    safeMessage(obj?.message) ||
    safeMessage(obj?.error) ||
    (error instanceof Error ? error.message : undefined) ||
    fallbackMessage;

  const status =
    (typeof nested?.status === 'number' ? nested.status : undefined) ??
    (typeof obj?.status === 'number' ? obj.status : undefined);
  const details = nested?.details ?? obj?.details ?? obj?.detail;
  const correlationId =
    (typeof nested?.correlation_id === 'string' ? nested.correlation_id : undefined) ||
    (typeof nested?.correlationId === 'string' ? nested.correlationId : undefined) ||
    (typeof obj?.correlation_id === 'string' ? obj.correlation_id : undefined) ||
    (typeof obj?.correlationId === 'string' ? obj.correlationId : undefined);

  return { code, message, details, status, correlationId };
}

export function toApiLayerError(error: unknown, fallbackMessage?: string): ApiLayerError {
  return new ApiLayerError(normalizeApiError(error, fallbackMessage));
}
