/**
 * Backend configuration for import functionality
 * 
 * Frontend uses ONLY:
 * - Supabase Storage bucket for file uploads
 * - Edge Functions as gateway to Cloud Run worker
 * 
 * All sensitive configuration (worker URL, secrets) lives in Edge Function secrets only.
 */

// Supabase Storage bucket for imports (must be created in Supabase Dashboard)
export const STORAGE_BUCKET = 'imports' as const;

// Edge Functions gateway endpoints
export const ImportGatewayApi = {
  parse: 'import-parse',
  validate: 'import-validate',
  publish: 'import-publish',
  normalize: 'import-normalize',
} as const;

// Supported file formats for import
export type FileFormat = 'csv' | 'xlsx' | 'xls' | 'pdf' | 'jsonl' | 'parquet';

/**
 * Get file format from file extension
 */
export function getFileFormat(fileName: string): FileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.jsonl')) return 'jsonl';
  if (lower.endsWith('.parquet')) return 'parquet';
  return null;
}

/**
 * Check if format is currently supported by the worker
 */
export function isFormatSupported(fmt: FileFormat): boolean {
  return fmt === 'csv' || fmt === 'xlsx' || fmt === 'xls' || fmt === 'pdf';
}

/**
 * IMPORTANT:
 * Supabase Storage keys must be ASCII-safe.
 * We store original filename in import_jobs.file_name, but in storage we use a safe deterministic name.
 * 
 * Format: {organization_id}/{import_job_id}/price_{import_job_id}.{ext}
 */
export function generateStoragePath(
  organizationId: string,
  importJobId: string,
  originalFileName: string
): string {
  const fmt = getFileFormat(originalFileName);
  const ext = fmt ? `.${fmt}` : '';
  // Always safe ASCII filename
  const safeName = `price_${importJobId}${ext}`;
  return `${organizationId}/${importJobId}/${safeName}`;
}
