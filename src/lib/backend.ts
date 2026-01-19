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
export const STORAGE_BUCKET = 'imports';

// Edge Functions gateway endpoints
export const ImportGatewayApi = {
  validate: 'import-validate',
  publish: 'import-publish',
};

// Supported file formats for import
export const SUPPORTED_IMPORT_FORMATS = ['csv', 'xlsx'] as const;
export const PENDING_IMPORT_FORMATS = ['jsonl', 'parquet'] as const;

export type SupportedFormat = typeof SUPPORTED_IMPORT_FORMATS[number];
export type PendingFormat = typeof PENDING_IMPORT_FORMATS[number];
export type FileFormat = SupportedFormat | PendingFormat;

/**
 * Get file format from file extension
 */
export function getFileFormat(filename: string): FileFormat | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'csv': return 'csv';
    case 'xlsx': case 'xls': return 'xlsx';
    case 'jsonl': return 'jsonl';
    case 'parquet': return 'parquet';
    default: return null;
  }
}

/**
 * Check if format is currently supported by the worker
 */
export function isFormatSupported(format: FileFormat): boolean {
  return (SUPPORTED_IMPORT_FORMATS as readonly string[]).includes(format);
}

/**
 * Generate storage path for import file
 * Format: {organization_id}/{import_job_id}/{filename}
 */
export function generateStoragePath(organizationId: string, importJobId: string, filename: string): string {
  return `${organizationId}/${importJobId}/${filename}`;
}
