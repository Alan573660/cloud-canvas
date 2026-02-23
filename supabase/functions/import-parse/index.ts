/**
 * import-parse — Edge Function for parsing uploaded files.
 *
 * Supports: CSV, XLSX, XLS, PDF (text + scanned via Gemini Vision).
 * Stores parsed rows in import_staging_rows for subsequent normalization.
 *
 * Flow: File in Storage → Parse → Validate columns → Write to staging → Return stats
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseCsv, parseExcel, parsePdfWithGemini, validateParsedData, autoMapColumns } from '../_shared/parse-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParseRequest {
  organization_id: string;
  import_job_id: string;
  file_path: string;
  file_format: 'csv' | 'xlsx' | 'xls' | 'pdf';
  options?: {
    delimiter?: string;
  } | null;
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

    // ─── Parse request ───────────────────────────────────────
    const body: ParseRequest = await req.json();
    console.log('[import-parse] Request:', {
      user_id: user.id,
      organization_id: body.organization_id,
      import_job_id: body.import_job_id,
      file_format: body.file_format,
    });

    if (!body.organization_id || !body.import_job_id || !body.file_path || !body.file_format) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields', error_code: 'MISSING_FIELDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ─── Org membership check ────────────────────────────────
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

    // ─── Update job status ───────────────────────────────────
    await adminClient
      .from('import_jobs')
      .update({ status: 'VALIDATING', started_at: new Date().toISOString() })
      .eq('id', body.import_job_id)
      .eq('organization_id', body.organization_id);

    // ─── Download file from storage ──────────────────────────
    const { data: fileData, error: downloadError } = await adminClient
      .storage
      .from('imports')
      .download(body.file_path);

    if (downloadError || !fileData) {
      console.error('[import-parse] Download error:', downloadError);
      await adminClient.from('import_jobs').update({
        status: 'FAILED',
        error_message: 'File not found in storage',
        error_code: 'FILE_NOT_FOUND',
        finished_at: new Date().toISOString(),
      }).eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({ ok: false, error: 'File not found', error_code: 'FILE_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Parse file based on format ──────────────────────────
    let headers: string[] = [];
    let rows: Record<string, string>[] = [];
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    console.log(`[import-parse] Parsing ${body.file_format}, size: ${fileBytes.length} bytes`);

    try {
      switch (body.file_format) {
        case 'csv': {
          const text = new TextDecoder('utf-8').decode(fileBytes);
          const result = parseCsv(text, body.options?.delimiter);
          headers = result.headers;
          rows = result.rows;
          break;
        }
        case 'xlsx':
        case 'xls': {
          const result = await parseExcel(fileBytes);
          headers = result.headers;
          rows = result.rows;
          break;
        }
        case 'pdf': {
          const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
          if (!lovableApiKey) {
            throw new Error('LOVABLE_API_KEY not configured for PDF parsing');
          }
          const result = await parsePdfWithGemini(fileBytes, lovableApiKey);
          headers = result.headers;
          rows = result.rows;
          break;
        }
        default:
          throw new Error(`Unsupported format: ${body.file_format}`);
      }
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('[import-parse] Parse error:', msg);

      await adminClient.from('import_jobs').update({
        status: 'FAILED',
        error_message: `Ошибка парсинга: ${msg.substring(0, 400)}`,
        error_code: 'PARSE_ERROR',
        finished_at: new Date().toISOString(),
      }).eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({ ok: false, error: msg, error_code: 'PARSE_ERROR' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[import-parse] Parsed: ${headers.length} columns, ${rows.length} rows`);

    // ─── Validate mandatory columns ──────────────────────────
    const validation = validateParsedData(headers, rows);
    if (!validation.ok) {
      console.log('[import-parse] Validation failed:', validation.error);

      // Don't mark as FAILED — return mapping info for UI
      await adminClient.from('import_jobs').update({
        status: 'QUEUED',
        error_code: validation.error_code || 'VALIDATION_ERROR',
        total_rows: rows.length,
      }).eq('id', body.import_job_id);

      return new Response(
        JSON.stringify({
          ok: false,
          error: validation.error,
          error_code: validation.error_code,
          detected_columns: headers,
          total_rows: rows.length,
          ...validation.details,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Auto-map columns ────────────────────────────────────
    const mapping = autoMapColumns(headers);
    console.log('[import-parse] Column mapping:', mapping);

    // ─── Clear old staging rows for this job ─────────────────
    await adminClient
      .from('import_staging_rows')
      .delete()
      .eq('import_job_id', body.import_job_id)
      .eq('organization_id', body.organization_id);

    // ─── Insert staging rows in batches ──────────────────────
    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((row, idx) => ({
        import_job_id: body.import_job_id,
        organization_id: body.organization_id,
        row_number: i + idx + 1,
        data: row,
        validation_status: 'VALID',
      }));

      const { error: insertError } = await adminClient
        .from('import_staging_rows')
        .insert(batch);

      if (insertError) {
        console.error(`[import-parse] Insert batch error (rows ${i}-${i + batch.length}):`, insertError);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`[import-parse] Inserted ${inserted}/${rows.length} staging rows`);

    // ─── Update job status ───────────────────────────────────
    await adminClient.from('import_jobs').update({
      status: 'VALIDATED',
      total_rows: rows.length,
      valid_rows: inserted,
      invalid_rows: rows.length - inserted,
      finished_at: new Date().toISOString(),
      summary: {
        columns: headers,
        mapping,
        format: body.file_format,
        parsed_at: new Date().toISOString(),
      },
    }).eq('id', body.import_job_id);

    return new Response(
      JSON.stringify({
        ok: true,
        import_job_id: body.import_job_id,
        total_rows: rows.length,
        valid_rows: inserted,
        invalid_rows: rows.length - inserted,
        detected_columns: headers,
        mapping,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[import-parse] Unexpected error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ ok: false, error: msg, error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
