import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cloud Run Import Worker URL
const IMPORT_WORKER_URL = Deno.env.get('IMPORT_WORKER_URL') || 
  'https://price-import-worker-s2ikab6a6a-uc.a.run.app';

interface ValidateRequest {
  organization_id: string;
  import_job_id: string;
  file_path: string; // Path in Supabase Storage: {org_id}/{job_id}/{filename}
  file_format: 'csv' | 'xlsx' | 'jsonl' | 'parquet';
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
        JSON.stringify({ error: 'Unauthorized' }),
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
        JSON.stringify({ error: 'Unauthorized', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: ValidateRequest = await req.json();
    console.log('[import-validate] Request:', { 
      user_id: user.id, 
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_format: body.file_format 
    });

    // Validate required fields
    if (!body.organization_id || !body.import_job_id || !body.file_path || !body.file_format) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
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
        JSON.stringify({ error: 'Profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (profile.organization_id !== body.organization_id) {
      console.error('[import-validate] Organization mismatch:', {
        user_org: profile.organization_id,
        request_org: body.organization_id
      });
      return new Response(
        JSON.stringify({ error: 'Access denied to this organization' }),
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
          finished_at: new Date().toISOString()
        })
        .eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({ error: 'File not found in storage. Please upload the file first.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[import-validate] Got signed URL, calling worker...');

    // Call Cloud Run Import Worker
    const workerResponse = await fetch(`${IMPORT_WORKER_URL}/api/import/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: body.organization_id,
        import_job_id: body.import_job_id,
        file_url: signedUrlData.signedUrl,
        file_format: body.file_format,
        dry_run: true,
      }),
    });

    const workerResult = await workerResponse.text();
    console.log('[import-validate] Worker response:', workerResponse.status, workerResult);

    if (!workerResponse.ok) {
      // Update job status to FAILED
      await supabaseAdmin
        .from('import_jobs')
        .update({ 
          status: 'FAILED', 
          error_message: workerResult.slice(0, 500),
          finished_at: new Date().toISOString()
        })
        .eq('id', body.import_job_id);

      return new Response(
        workerResult,
        { 
          status: workerResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update job status - worker should have updated it, but ensure it's not stuck
    await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'QUEUED' }) // Ready for publish
      .eq('id', body.import_job_id)
      .eq('status', 'VALIDATING'); // Only if still validating

    // Parse worker result
    let result;
    try {
      result = JSON.parse(workerResult);
    } catch {
      result = { message: workerResult };
    }

    console.log('[import-validate] Success');

    return new Response(
      JSON.stringify({ 
        success: true, 
        import_job_id: body.import_job_id,
        ...result 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[import-validate] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
