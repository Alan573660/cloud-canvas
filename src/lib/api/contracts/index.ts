export interface ApiBaseRequest {
  organization_id?: string;
  correlation_id?: string;
}

export interface ApiBaseResponse {
  ok?: boolean;
  code?: string;
  error?: string;
  error_code?: string;
  message?: string;
  detail?: unknown;
  correlation_id?: string;
}
