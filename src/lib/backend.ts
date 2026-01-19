/**
 * Backend configuration for external API calls
 * Uses env variables if available, otherwise falls back to hardcoded defaults.
 * This allows the app to work in Lovable without configuring secrets.
 */

// Fallback constants (used when env vars are not set)
const FALLBACK_IMPORT_WORKER_URL = 'https://price-import-worker-s2ikab6a6a-uc.a.run.app';
const FALLBACK_GCS_BUCKET = 'm2-prices-my-project-39021-1686504586397';

// Import Worker URL (Cloud Run) - used by Edge Functions, not directly from browser
const envWorkerUrl = import.meta.env.VITE_IMPORT_WORKER_URL;
export const IMPORT_WORKER_URL = envWorkerUrl || FALLBACK_IMPORT_WORKER_URL;

// GCS Bucket for price files (legacy, now using Supabase Storage)
const envGcsBucket = import.meta.env.VITE_GCS_BUCKET;
export const GCS_BUCKET = envGcsBucket || FALLBACK_GCS_BUCKET;

// Supabase Storage bucket for imports
export const STORAGE_BUCKET = 'imports';

// Log warnings if using fallbacks (only once on module load)
if (!envWorkerUrl) {
  console.warn('[backend] VITE_IMPORT_WORKER_URL not set, Edge Functions will use fallback');
}
if (!envGcsBucket) {
  console.warn('[backend] VITE_GCS_BUCKET not set, using fallback (for legacy GCS flows)');
}

// Export info for UI display
export const BackendConfig = {
  importWorkerUrl: IMPORT_WORKER_URL,
  gcsBucket: GCS_BUCKET,
  storageBucket: STORAGE_BUCKET,
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
 * Generate storage path for import file
 * Format: {organization_id}/{import_job_id}/{filename}
 */
export function generateStoragePath(organizationId: string, importJobId: string, filename: string): string {
  return `${organizationId}/${importJobId}/${filename}`;
}

/**
 * Generate GCS URI for import file (legacy)
 */
export function generateGcsUri(organizationId: string, importJobId: string, filename: string): string {
  return `gs://${GCS_BUCKET}/${organizationId}/${importJobId}/${filename}`;
}

/**
 * Import Worker API endpoints (via Edge Functions gateway)
 * These are the Supabase Edge Functions that proxy to Cloud Run
 */
export const ImportGatewayApi = {
  validate: 'import-validate',  // Edge function name
  publish: 'import-publish',    // Edge function name
};

/**
 * Legacy: Direct Cloud Run worker endpoints (not recommended from browser)
 */
export const ImportWorkerApi = {
  validate: `${IMPORT_WORKER_URL}/api/import/validate`,
  publish: `${IMPORT_WORKER_URL}/api/import/publish`,
};
