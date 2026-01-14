// Error handling utilities for user-friendly error messages

import { toast } from '@/hooks/use-toast';

// Map of Supabase/PostgreSQL error codes to user-friendly messages
const ERROR_MESSAGES: Record<string, { ru: string; en: string }> = {
  '23505': { ru: 'Запись с такими данными уже существует', en: 'A record with this data already exists' },
  '23503': { ru: 'Невозможно выполнить операцию: связанная запись не найдена', en: 'Cannot perform operation: related record not found' },
  '23502': { ru: 'Заполните все обязательные поля', en: 'Please fill in all required fields' },
  '42501': { ru: 'Недостаточно прав для выполнения операции', en: 'Insufficient permissions for this operation' },
  '42P01': { ru: 'Системная ошибка: таблица не найдена', en: 'System error: table not found' },
  'PGRST116': { ru: 'Запись не найдена', en: 'Record not found' },
  'PGRST301': { ru: 'Недостаточно прав', en: 'Insufficient permissions' },
  'invalid_grant': { ru: 'Неверный email или пароль', en: 'Invalid email or password' },
  'email_not_confirmed': { ru: 'Email не подтверждён. Проверьте почту', en: 'Email not confirmed. Check your inbox' },
  'user_not_found': { ru: 'Пользователь не найден', en: 'User not found' },
  'weak_password': { ru: 'Пароль слишком простой. Используйте минимум 8 символов', en: 'Password too weak. Use at least 8 characters' },
  'email_taken': { ru: 'Этот email уже зарегистрирован', en: 'This email is already registered' },
  'rate_limit': { ru: 'Слишком много попыток. Подождите немного', en: 'Too many attempts. Please wait' },
};

// Patterns to detect and map error types
const ERROR_PATTERNS: Array<{ pattern: RegExp; message: { ru: string; en: string } }> = [
  { pattern: /duplicate key/i, message: { ru: 'Запись с такими данными уже существует', en: 'A record with this data already exists' } },
  { pattern: /foreign key/i, message: { ru: 'Связанная запись не найдена', en: 'Related record not found' } },
  { pattern: /not null/i, message: { ru: 'Заполните все обязательные поля', en: 'Please fill in all required fields' } },
  { pattern: /permission denied|not allowed/i, message: { ru: 'Недостаточно прав', en: 'Insufficient permissions' } },
  { pattern: /network|fetch|connection/i, message: { ru: 'Ошибка сети. Проверьте подключение', en: 'Network error. Check your connection' } },
  { pattern: /timeout/i, message: { ru: 'Превышено время ожидания. Попробуйте снова', en: 'Request timed out. Please try again' } },
  { pattern: /invalid.*email/i, message: { ru: 'Неверный формат email', en: 'Invalid email format' } },
  { pattern: /invalid.*phone/i, message: { ru: 'Неверный формат телефона', en: 'Invalid phone format' } },
];

interface ErrorInfo {
  userMessage: string;
  technicalDetails: string;
  code?: string;
}

/**
 * Parse an error and return user-friendly message with technical details for logging
 */
export function parseError(error: unknown, lang: 'ru' | 'en' = 'ru'): ErrorInfo {
  const technicalDetails = error instanceof Error 
    ? error.message 
    : typeof error === 'string' 
      ? error 
      : JSON.stringify(error);

  // Extract error code if available
  const errorObj = error as { code?: string; message?: string; details?: string };
  const code = errorObj?.code;
  const message = errorObj?.message || technicalDetails;

  // Check for known error codes
  if (code && ERROR_MESSAGES[code]) {
    return {
      userMessage: ERROR_MESSAGES[code][lang],
      technicalDetails: message,
      code,
    };
  }

  // Check for error patterns
  for (const { pattern, message: msg } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        userMessage: msg[lang],
        technicalDetails: message,
      };
    }
  }

  // Default message
  return {
    userMessage: lang === 'ru' 
      ? 'Произошла ошибка. Попробуйте снова' 
      : 'An error occurred. Please try again',
    technicalDetails: message,
  };
}

/**
 * Show a user-friendly toast for an error, logging technical details to console
 */
export function showErrorToast(
  error: unknown, 
  options?: { 
    title?: string; 
    lang?: 'ru' | 'en';
    logPrefix?: string;
  }
): void {
  const lang = options?.lang || 'ru';
  const { userMessage, technicalDetails, code } = parseError(error, lang);
  
  // Log technical details for debugging
  console.error(
    options?.logPrefix ? `[${options.logPrefix}]` : '[Error]',
    { code, technicalDetails, originalError: error }
  );

  // Show user-friendly toast
  toast({
    title: options?.title || (lang === 'ru' ? 'Ошибка' : 'Error'),
    description: userMessage,
    variant: 'destructive',
  });
}

/**
 * Wrapper for async operations with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options?: {
    errorTitle?: string;
    lang?: 'ru' | 'en';
    logPrefix?: string;
    onError?: (error: unknown) => void;
  }
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    showErrorToast(error, {
      title: options?.errorTitle,
      lang: options?.lang,
      logPrefix: options?.logPrefix,
    });
    options?.onError?.(error);
    return null;
  }
}
