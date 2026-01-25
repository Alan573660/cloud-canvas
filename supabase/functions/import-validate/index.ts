import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cloud Run Import Worker URL (from secrets)
const IMPORT_WORKER_URL = Deno.env.get('IMPORT_WORKER_URL');
const IMPORT_SHARED_SECRET = Deno.env.get('IMPORT_SHARED_SECRET');

// Column mapping types
interface ColumnMapping {
  [targetField: string]: string; // targetField -> sourceColumn
}

interface ValidateRequest {
  organization_id: string;
  import_job_id: string;
  file_path: string; // Path in Supabase Storage: {org_id}/{job_id}/{filename}
  file_format: 'csv' | 'xlsx' | 'jsonl' | 'parquet';
  mapping?: ColumnMapping | null; // Optional column mapping
  options?: {
    skip_header?: boolean;
    delimiter?: string;
    strict_roofing_only_m2?: boolean; // Only import м² items
    excluded_row_numbers?: number[]; // Row numbers to exclude
    transform?: {
      sanitize_id?: boolean;
      normalize_price?: boolean;
      trim_text?: boolean;
    };
  } | null;
}

interface ValidateResponse {
  ok: boolean;
  import_job_id: string;
  error_code?: string;
  error?: string;
  detected_columns?: string[];
  missing_required?: string[];
  suggestions?: Record<string, string[]>;
  total_rows?: number;
  valid_rows?: number;
  invalid_rows?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[import-validate] No authorization header');
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Client with user's token for auth verification
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error('[import-validate] Auth error:', authError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: ValidateRequest = await req.json();
    console.log('[import-validate] Request:', { 
      user_id: user.id, 
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_format: body.file_format,
      has_mapping: !!body.mapping
    });

    // Validate required fields
    if (!body.organization_id || !body.import_job_id || !body.file_path || !body.file_format) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields', error_code: 'MISSING_FIELDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service role client for storage operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user belongs to this organization
    const { data: profile, error: profileError } = await supabaseUser
      .from('profiles')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[import-validate] Profile error:', profileError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Profile not found', error_code: 'PROFILE_NOT_FOUND' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (profile.organization_id !== body.organization_id) {
      console.error('[import-validate] Organization mismatch:', {
        user_org: profile.organization_id,
        request_org: body.organization_id
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied to this organization', error_code: 'ACCESS_DENIED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update import job status to VALIDATING
    const { error: updateError } = await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'VALIDATING', started_at: new Date().toISOString() })
      .eq('id', body.import_job_id)
      .eq('organization_id', body.organization_id);

    if (updateError) {
      console.error('[import-validate] Failed to update job status:', updateError);
    }

    // Get signed URL for the file (valid for 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('imports')
      .createSignedUrl(body.file_path, 3600);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('[import-validate] Failed to get signed URL:', signedUrlError);
      
      // Update job status to FAILED
      await supabaseAdmin
        .from('import_jobs')
        .update({ 
          status: 'FAILED', 
          error_message: 'File not found in storage',
          error_code: 'FILE_NOT_FOUND',
          finished_at: new Date().toISOString()
        })
        .eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({ ok: false, error: 'File not found in storage. Please upload the file first.', error_code: 'FILE_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[import-validate] Got signed URL, calling worker...');

    // Validate secrets
    if (!IMPORT_WORKER_URL) {
      console.error('[import-validate] IMPORT_WORKER_URL secret not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'Server configuration error: IMPORT_WORKER_URL not set', error_code: 'CONFIG_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!IMPORT_SHARED_SECRET) {
      console.error('[import-validate] IMPORT_SHARED_SECRET secret not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'Server configuration error: IMPORT_SHARED_SECRET not set', error_code: 'CONFIG_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Cloud Run Import Worker with shared secret
    const workerPayload: Record<string, unknown> = {
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_url: signedUrlData.signedUrl,
      file_format: body.file_format,
      dry_run: true,
    };

    // Add mapping if provided
    if (body.mapping) {
      workerPayload.mapping = body.mapping;
    }

    // Add options if provided
    if (body.options) {
      workerPayload.options = body.options;
    }

    const workerResponse = await fetch(`${IMPORT_WORKER_URL}/api/import/validate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Import-Secret': IMPORT_SHARED_SECRET 
      },
      body: JSON.stringify(workerPayload),
    });

    const workerResult = await workerResponse.text();
    console.log('[import-validate] Worker response:', workerResponse.status, workerResult.slice(0, 500));

    // Parse worker result
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(workerResult);
    } catch {
      result = { message: workerResult };
    }

    // Handle worker errors with better messaging
    if (!workerResponse.ok) {
      // Check for MISSING_REQUIRED_COLUMNS error - this triggers mapping UI
      const isMissingColumns = 
        result.error_code === 'MISSING_REQUIRED_COLUMNS' ||
        (result.detail && typeof result.detail === 'string' && result.detail.includes('Missing required columns')) ||
        (Array.isArray(result.missing_required) && result.missing_required.length > 0);

      if (isMissingColumns) {
        // Return special response for mapping UI
        const response: ValidateResponse = {
          ok: false,
          import_job_id: body.import_job_id,
          error_code: 'MISSING_REQUIRED_COLUMNS',
          error: result.detail as string || 'Missing required columns',
          detected_columns: result.detected_columns as string[] || [],
          missing_required: result.missing_required as string[] || ['id', 'price_rub_m2'],
          suggestions: result.suggestions as Record<string, string[]> || {},
        };

        // Update job status to PENDING_MAPPING
        await supabaseAdmin
          .from('import_jobs')
          .update({ 
            status: 'QUEUED', // Keep as QUEUED, waiting for mapping
            error_code: 'MISSING_REQUIRED_COLUMNS',
          })
          .eq('id', body.import_job_id);

        console.log('[import-validate] Missing columns, returning for mapping UI');

        return new Response(
          JSON.stringify(response),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract meaningful error message from worker response
      const workerErrorMessage = 
        result.detail || 
        result.error || 
        result.message || 
        (workerResponse.status === 500 ? 'Worker internal error - check worker logs and configuration' : workerResult);

      // Log detailed error for debugging
      console.error('[import-validate] Worker error:', {
        status: workerResponse.status,
        error_code: result.error_code,
        message: workerErrorMessage,
        raw: workerResult.slice(0, 200)
      });

      // Update job with detailed error
      await supabaseAdmin
        .from('import_jobs')
        .update({ 
          status: 'FAILED', 
          error_message: String(workerErrorMessage).slice(0, 500),
          error_code: result.error_code as string || 'WORKER_ERROR',
          finished_at: new Date().toISOString()
        })
        .eq('id', body.import_job_id);

      // Return detailed error to UI
      return new Response(
        JSON.stringify({ 
          ok: false, 
          import_job_id: body.import_job_id,
          error: workerErrorMessage,
          error_code: result.error_code || 'WORKER_ERROR',
          message: `Worker returned ${workerResponse.status}: ${String(workerErrorMessage).slice(0, 200)}`,
          detected_columns: result.detected_columns,
          missing_required: result.missing_required,
          suggestions: result.suggestions,
        }),
        { 
          status: 200, // Return 200 so UI can parse error details
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Success - update job status to VALIDATED
    const { error: validateUpdateError } = await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'VALIDATED' })
      .eq('id', body.import_job_id);

    if (validateUpdateError) {
      console.error('[import-validate] Failed to update job to VALIDATED:', validateUpdateError);
    } else {
      console.log('[import-validate] Job updated to VALIDATED successfully');
    }

    const successResponse: ValidateResponse = {
      ok: true,
      import_job_id: body.import_job_id,
      total_rows: result.total_rows as number,
      valid_rows: result.valid_rows as number,
      invalid_rows: result.invalid_rows as number,
    };

    return new Response(
      JSON.stringify(successResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[import-validate] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error', error_code: 'INTERNAL_ERROR', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
