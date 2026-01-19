/**
 * Backend configuration for external API calls
 * PRODUCTION MODE: No fallbacks - all env variables are required.
 * 
 * Required env variables:
 * - VITE_IMPORT_WORKER_URL: Cloud Run Import Worker URL
 * - VITE_GCS_BUCKET: GCS bucket for legacy flows (optional, but logged if missing)
 * 
 * Edge Functions use (via Supabase secrets, NOT in frontend):
 * - IMPORT_WORKER_URL
 * - IMPORT_SHARED_SECRET
 */

// Supabase Storage bucket for imports (fixed name, must be created in Supabase Dashboard)
export const STORAGE_BUCKET = 'imports';

// Import Worker URL - used for display purposes only (actual calls go through Edge Functions)
const envWorkerUrl = import.meta.env.VITE_IMPORT_WORKER_URL as string | undefined;

// GCS Bucket - legacy, kept for reference/display only
const envGcsBucket = import.meta.env.VITE_GCS_BUCKET as string | undefined;

// Validate required configuration
function validateConfig(): { workerUrl: string; gcsBucket: string | null } {
  if (!envWorkerUrl) {
    const error = '[backend] CRITICAL: VITE_IMPORT_WORKER_URL is not configured. Import functionality will not work.';
    console.error(error);
    // Don't throw here - let UI handle gracefully
  }
  
  if (!envGcsBucket) {
    console.warn('[backend] VITE_GCS_BUCKET not set (legacy GCS flow disabled)');
  }
  
  return {
    workerUrl: envWorkerUrl || '',
    gcsBucket: envGcsBucket || null,
  };
}

const config = validateConfig();

// Export constants (may be empty if not configured)
export const IMPORT_WORKER_URL = config.workerUrl;
export const GCS_BUCKET = config.gcsBucket || '';

// Export info for UI display and validation
export const BackendConfig = {
  importWorkerUrl: IMPORT_WORKER_URL,
  gcsBucket: GCS_BUCKET,
  storageBucket: STORAGE_BUCKET,
  isConfigured: Boolean(envWorkerUrl),
  isMissingWorkerUrl: !envWorkerUrl,
  isMissingGcsBucket: !envGcsBucket,
};

/**
 * Check if import functionality is properly configured
 * @throws Error if required configuration is missing
 */
export function assertImportConfigured(): void {
  if (!envWorkerUrl) {
    throw new Error('Import not configured: VITE_IMPORT_WORKER_URL environment variable is required');
  }
}

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
