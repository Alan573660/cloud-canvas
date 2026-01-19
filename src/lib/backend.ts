/**
 * Backend configuration for external API calls
 * These values should be set in .env for production:
 * - VITE_IMPORT_WORKER_URL
 * - VITE_GCS_BUCKET
 */

// Import Worker URL (Cloud Run)
export const IMPORT_WORKER_URL = import.meta.env.VITE_IMPORT_WORKER_URL 
  || 'https://price-import-worker-s2ikab6a6a-uc.a.run.app';

// GCS Bucket for price files
export const GCS_BUCKET = import.meta.env.VITE_GCS_BUCKET 
  || 'm2-prices-my-project-39021-1686504586397';

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
 * Generate GCS URI for import file
 */
export function generateGcsUri(organizationId: string, importJobId: string, filename: string): string {
  return `gs://${GCS_BUCKET}/${organizationId}/${importJobId}/${filename}`;
}

/**
 * Import Worker API endpoints
 */
export const ImportWorkerApi = {
  validate: `${IMPORT_WORKER_URL}/api/import/validate`,
  publish: `${IMPORT_WORKER_URL}/api/import/publish`,
};
