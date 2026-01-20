// Audit logging utilities for PII access tracking
import { supabase } from '@/integrations/supabase/client';

export type AuditEventType = 
  | 'view_list'
  | 'view_record'
  | 'export_attempt'
  | 'bulk_select';

export type AuditEntity = 
  | 'contacts'
  | 'parsed_leads'
  | 'buyer_companies'
  | 'leads';

interface AuditLogParams {
  organizationId: string;
  eventType: AuditEventType;
  entity: AuditEntity;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Logs an audit event to usage_logs table
 * Non-blocking - errors are logged but don't affect the caller
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  const { organizationId, eventType, entity, entityId, details } = params;

  try {
    // We use usage_logs table with event_type for audit logging
    // The schema has: organization_id, event_type, source_id, lead_id, etc.
    const { error } = await supabase.from('usage_logs').insert({
      organization_id: organizationId,
      event_type: `audit:${eventType}:${entity}`,
      source_id: entityId || null,
      // Store additional details in a way that fits the schema
      // cost_rub, tokens_in, tokens_out, duration_seconds default to 0
      cost_rub: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_seconds: 0,
    });

    if (error) {
      // Log but don't throw - audit logging should never break the app
      console.warn('[Audit] Failed to log event:', error.message, params);
    } else {
      console.debug('[Audit] Event logged:', `${eventType}:${entity}`, entityId);
    }
  } catch (err) {
    console.warn('[Audit] Exception logging event:', err);
  }
}

/**
 * Hook-style audit logger for list views
 */
export function logListView(organizationId: string, entity: AuditEntity): void {
  // Fire and forget
  logAuditEvent({
    organizationId,
    eventType: 'view_list',
    entity,
  });
}

/**
 * Hook-style audit logger for record views
 */
export function logRecordView(
  organizationId: string, 
  entity: AuditEntity, 
  entityId: string
): void {
  // Fire and forget
  logAuditEvent({
    organizationId,
    eventType: 'view_record',
    entity,
    entityId,
  });
}

/**
 * Hook-style audit logger for export attempts
 */
export function logExportAttempt(
  organizationId: string, 
  entity: AuditEntity,
  count?: number
): void {
  // Fire and forget
  logAuditEvent({
    organizationId,
    eventType: 'export_attempt',
    entity,
    details: count ? { count } : undefined,
  });
}
