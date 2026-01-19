import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cloud Run Import Worker URL
const IMPORT_WORKER_URL = Deno.env.get('IMPORT_WORKER_URL') || 
  'https://price-import-worker-s2ikab6a6a-uc.a.run.app';

interface PublishRequest {
  organization_id: string;
  import_job_id: string;
  file_path: string; // Path in Supabase Storage
  file_format: 'csv' | 'xlsx' | 'jsonl' | 'parquet';
  archive_before_replace?: boolean;
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
      console.error('[import-publish] Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: authError?.message }),
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
      archive_before_replace: body.archive_before_replace
    });

    // Validate required fields
    if (!body.organization_id || !body.import_job_id || !body.file_path || !body.file_format) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
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
        JSON.stringify({ error: 'Profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (profile.organization_id !== body.organization_id) {
      console.error('[import-publish] Organization mismatch');
      return new Response(
        JSON.stringify({ error: 'Access denied to this organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check role - only owner, admin can publish
    const allowedRoles = ['owner', 'admin'];
    if (!allowedRoles.includes(profile.role)) {
      console.error('[import-publish] Insufficient role:', profile.role);
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions. Only admins can publish imports.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update import job status to APPLYING
    const { error: updateError } = await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'APPLYING' })
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
          finished_at: new Date().toISOString()
        })
        .eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({ error: 'File not found in storage' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[import-publish] Got signed URL, calling worker...');

    // Call Cloud Run Import Worker
    const workerResponse = await fetch(`${IMPORT_WORKER_URL}/api/import/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: body.organization_id,
        import_job_id: body.import_job_id,
        file_url: signedUrlData.signedUrl,
        file_format: body.file_format,
        archive_before_replace: body.archive_before_replace ?? true,
        dry_run: false,
      }),
    });

    const workerResult = await workerResponse.text();
    console.log('[import-publish] Worker response:', workerResponse.status, workerResult);

    if (!workerResponse.ok) {
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

    // Update job status to DONE
    await supabaseAdmin
      .from('import_jobs')
      .update({ 
        status: 'DONE',
        finished_at: new Date().toISOString()
      })
      .eq('id', body.import_job_id);

    // Parse worker result
    let result;
    try {
      result = JSON.parse(workerResult);
    } catch {
      result = { message: workerResult };
    }

    console.log('[import-publish] Success, import job completed');

    return new Response(
      JSON.stringify({ 
        success: true, 
        import_job_id: body.import_job_id,
        status: 'DONE',
        ...result 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[import-publish] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
