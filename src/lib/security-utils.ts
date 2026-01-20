// Security utilities for input sanitization and escaping

/**
 * Escapes special characters for ILIKE queries to prevent SQL injection
 * Handles: backslash, percent, underscore
 * @param input - Raw user input
 * @returns Escaped string safe for ILIKE
 */
export function escapeLike(input: string): string {
  if (!input) return '';
  
  return input
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')     // Escape percent
    .replace(/_/g, '\\_');    // Escape underscore
}

/**
 * Sanitizes and limits search query input
 * - Trims whitespace
 * - Limits length to maxLength (default 64)
 * - Escapes ILIKE special characters
 * @param query - Raw search query
 * @param maxLength - Maximum allowed length (default 64)
 * @returns Sanitized and escaped query
 */
export function sanitizeSearchQuery(query: string, maxLength = 64): string {
  if (!query) return '';
  
  const trimmed = query.trim().slice(0, maxLength);
  return escapeLike(trimmed);
}

/**
 * Checks if a role has admin-level permissions
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Checks if a role can manage data (create/edit/delete)
 */
export function canManageData(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'operator';
}

/**
 * Checks if role is accountant (read-only, no calls access)
 */
export function isAccountant(role: string | null | undefined): boolean {
  return role === 'accountant';
}

/**
 * Role-based feature access matrix
 */
export const ROLE_PERMISSIONS = {
  // Calls module - accountant cannot access
  calls: {
    view: ['owner', 'admin', 'operator'],
    manage: ['owner', 'admin'],
  },
  // Parsed leads - only admin can access
  parsedLeads: {
    view: ['owner', 'admin'],
    export: ['owner', 'admin'],
  },
  // Contacts - all can view, accountant cannot manage
  contacts: {
    view: ['owner', 'admin', 'operator', 'accountant'],
    manage: ['owner', 'admin', 'operator'],
    export: ['owner', 'admin'],
  },
  // General export - restricted to admins
  export: {
    allowed: ['owner', 'admin'],
  },
  // Bulk selection on PII tables
  bulkSelect: {
    allowed: ['owner', 'admin'],
  },
} as const;

/**
 * Check if role has permission for a specific action
 */
export function hasPermission(
  role: string | null | undefined,
  module: keyof typeof ROLE_PERMISSIONS,
  action: string
): boolean {
  if (!role) return false;
  
  const modulePerms = ROLE_PERMISSIONS[module] as Record<string, readonly string[]>;
  const allowedRoles = modulePerms?.[action];
  
  if (!allowedRoles) return false;
  
  return allowedRoles.includes(role);
}
