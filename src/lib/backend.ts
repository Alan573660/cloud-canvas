/**
 * Backend configuration for external API calls
 * Uses env variables if available, otherwise falls back to hardcoded defaults.
 * This allows the app to work in Lovable without configuring secrets.
 */

// Fallback constants (used when env vars are not set)
const FALLBACK_IMPORT_WORKER_URL = 'https://price-import-worker-s2ikab6a6a-uc.a.run.app';
const FALLBACK_GCS_BUCKET = 'm2-prices-my-project-39021-1686504586397';

// Import Worker URL (Cloud Run)
const envWorkerUrl = import.meta.env.VITE_IMPORT_WORKER_URL;
export const IMPORT_WORKER_URL = envWorkerUrl || FALLBACK_IMPORT_WORKER_URL;

// GCS Bucket for price files
const envGcsBucket = import.meta.env.VITE_GCS_BUCKET;
export const GCS_BUCKET = envGcsBucket || FALLBACK_GCS_BUCKET;

// Log warnings if using fallbacks (only once on module load)
if (!envWorkerUrl) {
  console.warn('[backend] VITE_IMPORT_WORKER_URL not set, using fallback:', FALLBACK_IMPORT_WORKER_URL);
}
if (!envGcsBucket) {
  console.warn('[backend] VITE_GCS_BUCKET not set, using fallback:', FALLBACK_GCS_BUCKET);
}

// Export info for UI display
export const BackendConfig = {
  importWorkerUrl: IMPORT_WORKER_URL,
  gcsBucket: GCS_BUCKET,
  isUsingFallbackWorkerUrl: !envWorkerUrl,
  isUsingFallbackBucket: !envGcsBucket,
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
