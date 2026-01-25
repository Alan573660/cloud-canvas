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

interface PublishRequest {
  organization_id: string;
  import_job_id: string;
  file_path: string; // Path in Supabase Storage
  file_format: 'csv' | 'xlsx' | 'jsonl' | 'parquet';
  archive_before_replace?: boolean;
  mapping?: ColumnMapping | null; // Column mapping from validate step
  allow_partial?: boolean; // Import valid rows even if some have errors
  options?: {
    strict_roofing_only_m2?: boolean; // Only import м² items
    excluded_row_numbers?: number[]; // Row numbers to exclude
    transform?: {
      sanitize_id?: boolean;
      normalize_price?: boolean;
      trim_text?: boolean;
    };
  } | null;
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
      console.error('[import-publish] No authorization header');
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
      console.error('[import-publish] Auth error:', authError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: PublishRequest = await req.json();
    console.log('[import-publish] Request:', { 
      user_id: user.id, 
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_format: body.file_format,
      archive_before_replace: body.archive_before_replace,
      has_mapping: !!body.mapping
    });

    // Validate required fields
    if (!body.organization_id || !body.import_job_id || !body.file_path || !body.file_format) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields', error_code: 'MISSING_FIELDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user belongs to this organization and has appropriate role
    const { data: profile, error: profileError } = await supabaseUser
      .from('profiles')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[import-publish] Profile error:', profileError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Profile not found', error_code: 'PROFILE_NOT_FOUND' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (profile.organization_id !== body.organization_id) {
      console.error('[import-publish] Organization mismatch');
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied to this organization', error_code: 'ACCESS_DENIED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check role - only owner, admin can publish
    const allowedRoles = ['owner', 'admin'];
    if (!allowedRoles.includes(profile.role)) {
      console.error('[import-publish] Insufficient role:', profile.role);
      return new Response(
        JSON.stringify({ ok: false, error: 'Insufficient permissions. Only admins can publish imports.', error_code: 'INSUFFICIENT_PERMISSIONS' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update import job status to APPLYING
    const { error: updateError } = await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'APPLYING', started_at: new Date().toISOString() })
      .eq('id', body.import_job_id)
      .eq('organization_id', body.organization_id);

    if (updateError) {
      console.error('[import-publish] Failed to update job status:', updateError);
    }

    // Get signed URL for the file
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('imports')
      .createSignedUrl(body.file_path, 3600);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('[import-publish] Failed to get signed URL:', signedUrlError);
      
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
        JSON.stringify({ ok: false, error: 'File not found in storage', error_code: 'FILE_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[import-publish] Got signed URL, calling worker...');

    // Validate secrets
    if (!IMPORT_WORKER_URL) {
      console.error('[import-publish] IMPORT_WORKER_URL secret not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'Server configuration error: IMPORT_WORKER_URL not set', error_code: 'CONFIG_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!IMPORT_SHARED_SECRET) {
      console.error('[import-publish] IMPORT_SHARED_SECRET secret not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'Server configuration error: IMPORT_SHARED_SECRET not set', error_code: 'CONFIG_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build worker payload matching exact contract
    const workerPayload: Record<string, unknown> = {
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_url: signedUrlData.signedUrl,
      file_format: body.file_format,
      archive_before_replace: body.archive_before_replace ?? true,
      dry_run: false,
      // Allow partial publish - import valid rows even if some rows have errors
      allow_partial: body.allow_partial ?? true,
    };

    // Add mapping if provided
    if (body.mapping) {
      workerPayload.mapping = body.mapping;
    }

    // Add options (including transform, strict_roofing_only_m2, excluded_row_numbers) if provided
    if (body.options) {
      workerPayload.options = body.options;
    }

    // ASYNC FIRE-AND-FORGET: Call Cloud Run Import Worker
    // Worker will update import_jobs.status directly when done (COMPLETED/FAILED)
    // This prevents Edge Function timeout on large files (70k+ rows)
    fetch(`${IMPORT_WORKER_URL}/api/import/publish`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Import-Secret': IMPORT_SHARED_SECRET 
      },
      body: JSON.stringify(workerPayload),
    }).then(async (workerResponse) => {
      const workerResult = await workerResponse.text();
      console.log('[import-publish] Worker async response:', workerResponse.status, workerResult.slice(0, 500));
      
      // Worker should update status itself, but log if there's an issue
      if (!workerResponse.ok) {
        console.error('[import-publish] Worker async error:', workerResponse.status, workerResult.slice(0, 200));
      }
    }).catch((err) => {
      console.error('[import-publish] Worker async fetch error:', err);
      // Attempt to mark job as failed if worker call completely failed
      supabaseAdmin
        .from('import_jobs')
        .update({
          status: 'FAILED',
          error_message: `Worker unreachable: ${err.message}`,
          error_code: 'WORKER_UNREACHABLE',
          finished_at: new Date().toISOString(),
        })
        .eq('id', body.import_job_id)
        .then(() => {});
    });

    console.log('[import-publish] Worker call dispatched (async), returning immediately');

    // Return immediately - UI will poll import_jobs.status
    return new Response(
      JSON.stringify({ 
        ok: true, 
        import_job_id: body.import_job_id,
        status: 'APPLYING',
        message: 'Import started. Processing in background. Poll import_jobs for status updates.'
      }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[import-publish] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error', error_code: 'INTERNAL_ERROR', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
