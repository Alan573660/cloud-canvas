/**
 * Unified error handling for Edge Function responses.
 * 
 * Parses structured errors (422 detail, 401/403, 5xx) into human-readable messages.
 */

/**
 * Parse an Edge Function error into a user-friendly message.
 * Handles:
 * - 422: FastAPI detail array or message string
 * - 401/403: Access denied
 * - 5xx: Temporary service error
 * - Generic: First 200 chars of message
 */
export function parseEdgeFunctionError(
  error: unknown,
  data?: unknown
): string {
  // If data contains structured error info
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    
    // FastAPI 422 validation detail
    if (Array.isArray(d.detail)) {
      const messages = d.detail.map((item: { loc?: string[]; msg?: string; type?: string }) => {
        const field = item.loc?.slice(-1)?.[0] || 'unknown';
        return `${field}: ${item.msg || item.type || 'invalid'}`;
      });
      return messages.join('; ');
    }
    
    // Simple error message
    if (typeof d.error === 'string') return d.error.substring(0, 400);
    if (typeof d.detail === 'string') return d.detail.substring(0, 400);
    if (typeof d.message === 'string') return d.message.substring(0, 400);
  }

  // Error object
  if (error instanceof Error) {
    const msg = error.message;
    
    // Status-based classification
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return 'Ошибка авторизации. Войдите в систему заново.';
    }
    if (msg.includes('403') || msg.includes('Access denied') || msg.includes('Forbidden')) {
      return 'Нет доступа. Проверьте права в организации.';
    }
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
      return 'Временная ошибка сервиса. Попробуйте повторить через минуту.';
    }
    if (msg.includes('422')) {
      return `Ошибка валидации: ${msg.substring(0, 200)}`;
    }

    return msg.substring(0, 400);
  }

  if (typeof error === 'string') return error.substring(0, 400);

  return 'Неизвестная ошибка';
}

/**
 * Check if an error response indicates a PROFILE_HASH_MISMATCH.
 */
export function isHashMismatch(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  
  if (d.code === 'PROFILE_HASH_MISMATCH') return true;
  if (d.error_code === 'PROFILE_HASH_MISMATCH') return true;
  
  const errorStr = String(d.error || d.detail || '').toLowerCase();
  return errorStr.includes('profile_hash') && (errorStr.includes('mismatch') || errorStr.includes('409'));
}
