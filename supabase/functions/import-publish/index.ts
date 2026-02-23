/**
 * import-publish — Edge Function for publishing parsed data to BigQuery.
 *
 * Strategy: DELETE all org rows from BigQuery → INSERT new rows from staging.
 * Also cleans up old staging data after successful publish.
 *
 * No Cloud Run dependency — direct BigQuery REST API via GCP SA key.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { loadServiceAccount, bqDeleteOrganization, bqInsertRows } from '../_shared/bigquery.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PublishRequest {
  organization_id: string;
  import_job_id: string;
  archive_before_replace?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── Auth ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: PublishRequest = await req.json();
    console.log('[import-publish] Request:', {
      user_id: user.id,
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
    });

    if (!body.organization_id || !body.import_job_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields', error_code: 'MISSING_FIELDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ─── Role check (owner/admin only) ───────────────────────
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile || profile.organization_id !== body.organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied', error_code: 'ACCESS_DENIED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['owner', 'admin'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Only admins can publish imports', error_code: 'INSUFFICIENT_PERMISSIONS' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Update job to APPLYING ──────────────────────────────
    await adminClient.from('import_jobs').update({
      status: 'APPLYING',
      started_at: new Date().toISOString(),
    }).eq('id', body.import_job_id).eq('organization_id', body.organization_id);

    // ─── Load staging rows ───────────────────────────────────
    const { data: stagingRows, error: stagingError } = await adminClient
      .from('import_staging_rows')
      .select('row_number, data')
      .eq('import_job_id', body.import_job_id)
      .eq('organization_id', body.organization_id)
      .order('row_number', { ascending: true })
      .limit(100000);

    if (stagingError) {
      console.error('[import-publish] Staging read error:', stagingError);
      await markFailed(adminClient, body.import_job_id, 'Failed to read staging rows', 'STAGING_ERROR');
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to read staging data', error_code: 'STAGING_ERROR' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!stagingRows || stagingRows.length === 0) {
      await markFailed(adminClient, body.import_job_id, 'No staging rows to publish', 'EMPTY_STAGING');
      return new Response(
        JSON.stringify({ ok: false, error: 'No data to publish', error_code: 'EMPTY_STAGING' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[import-publish] Loaded ${stagingRows.length} staging rows`);

    // ─── Transform staging data to BigQuery rows ─────────────
    const bqRows = stagingRows.map((sr) => {
      const d = sr.data as Record<string, unknown>;
      return {
        organization_id: body.organization_id,
        import_job_id: body.import_job_id,
        row_number: sr.row_number,
        // Core fields from normalization
        title: d.title || d['Наименование'] || d['Номенклатура'] || d.name || '',
        sku: d.sku || d['Артикул'] || d['SKU'] || d.id || null,
        profile: d.profile || null,
        thickness_mm: parseFloat(String(d.thickness_mm || '0')) || null,
        coating: d.coating || null,
        color_code: d.color_code || null,
        color_system: d.color_system || null,
        width_work_mm: parseInt(String(d.width_work_mm || '0'), 10) || null,
        width_full_mm: parseInt(String(d.width_full_mm || '0'), 10) || null,
        price_rub_m2: parseFloat(String(d.price_rub_m2 || d['Цена'] || d.price || '0')) || 0,
        unit: d.unit || 'm2',
        sheet_kind: d.sheet_kind || 'OTHER',
        notes: d.notes || null,
        // Metadata
        raw_data: JSON.stringify(d),
        imported_at: new Date().toISOString(),
      };
    });

    // ─── BigQuery: Delete old + Insert new ───────────────────
    let sa;
    try {
      sa = loadServiceAccount();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[import-publish] SA load error:', msg);
      await markFailed(adminClient, body.import_job_id, msg, 'CONFIG_ERROR');
      return new Response(
        JSON.stringify({ ok: false, error: msg, error_code: 'CONFIG_ERROR' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      // Step 1: Delete old data
      console.log('[import-publish] Deleting old BQ rows for org:', body.organization_id);
      const deleteResult = await bqDeleteOrganization(sa, body.organization_id);
      console.log('[import-publish] Deleted:', deleteResult.deleted, 'rows');

      // Step 2: Insert new data
      console.log('[import-publish] Inserting', bqRows.length, 'rows to BQ');
      const insertResult = await bqInsertRows(sa, bqRows);
      console.log('[import-publish] Inserted:', insertResult.inserted, 'errors:', insertResult.errors.length);

      if (insertResult.errors.length > 0) {
        console.warn('[import-publish] Insert errors:', insertResult.errors.slice(0, 5).join('; '));
      }

      // Step 3: Clean up staging rows
      await adminClient
        .from('import_staging_rows')
        .delete()
        .eq('import_job_id', body.import_job_id)
        .eq('organization_id', body.organization_id);

      // Step 4: Clean up old import_errors for this job
      await adminClient
        .from('import_errors')
        .delete()
        .eq('import_job_id', body.import_job_id)
        .eq('organization_id', body.organization_id);

      // Step 5: Update job as COMPLETED
      await adminClient.from('import_jobs').update({
        status: 'COMPLETED',
        inserted_rows: insertResult.inserted,
        deleted_rows: deleteResult.deleted,
        invalid_rows: insertResult.errors.length,
        finished_at: new Date().toISOString(),
        summary: {
          bq_deleted: deleteResult.deleted,
          bq_inserted: insertResult.inserted,
          bq_errors: insertResult.errors.length,
          error_samples: insertResult.errors.slice(0, 5),
        },
      }).eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({
          ok: true,
          import_job_id: body.import_job_id,
          status: 'COMPLETED',
          inserted: insertResult.inserted,
          deleted: deleteResult.deleted,
          errors: insertResult.errors.length,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (bqError) {
      const msg = bqError instanceof Error ? bqError.message : String(bqError);
      console.error('[import-publish] BigQuery error:', msg);
      await markFailed(adminClient, body.import_job_id, `BigQuery: ${msg.substring(0, 400)}`, 'BQ_ERROR');
      return new Response(
        JSON.stringify({ ok: false, error: msg, error_code: 'BQ_ERROR' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[import-publish] Unexpected error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ ok: false, error: msg, error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Helpers ─────────────────────────────────────────────────

async function markFailed(
  client: ReturnType<typeof createClient>,
  jobId: string,
  errorMessage: string,
  errorCode: string
) {
  await client.from('import_jobs').update({
    status: 'FAILED',
    error_message: errorMessage.substring(0, 500),
    error_code: errorCode,
    finished_at: new Date().toISOString(),
  }).eq('id', jobId);
}
