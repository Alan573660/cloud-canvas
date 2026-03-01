export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    correlation_id?: string;
  };
};

export type HealthcheckResponse = ApiEnvelope<{ status: 'ok' }>;
