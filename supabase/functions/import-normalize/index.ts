/**
 * import-normalize — Edge Function for AI-powered normalization.
 *
 * Uses Lovable AI Gateway (Gemini) to extract product attributes:
 * - Profile (С8, С10, НС35, МП-20, etc.)
 * - Thickness (0.4, 0.45, 0.5 mm)
 * - Coating (Полиэстер, Пурал, Оцинковка)
 * - Color/RAL code
 * - Sheet kind (PROFNASTIL, METALLOCHEREPICA)
 * - Width (work/full mm)
 *
 * Reads staging rows, normalizes via AI, writes results back.
 * Preserves: settings-merge integration, confirmed rules from bot_settings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types ──────────────────────────────────────────────────

interface NormalizeRequest {
  op: 'dry_run' | 'apply' | 'apply_status' | 'stats' | 'dashboard' | 'tree' | 'confirm' | 'answer_question' | 'preview_rows' | 'chat';
  organization_id: string;
  import_job_id?: string;
  [key: string]: unknown;
}

interface NormalizedAttributes {
  profile: string | null;
  thickness_mm: number | null;
  coating: string | null;
  color_code: string | null;
  color_system: string | null;
  sheet_kind: string;
  width_work_mm: number | null;
  width_full_mm: number | null;
  unit: string;
}

// ─── Profile width reference ────────────────────────────────

const PROFILE_WIDTHS: Record<string, { work: number; full: number }> = {
  'С8': { work: 1150, full: 1200 },
  'С10': { work: 1100, full: 1150 },
  'С20': { work: 1100, full: 1150 },
  'С21': { work: 1000, full: 1051 },
  'С44': { work: 1000, full: 1047 },
  'НС35': { work: 1000, full: 1060 },
  'НС44': { work: 1000, full: 1052 },
  'Н57': { work: 750, full: 801 },
  'Н60': { work: 845, full: 902 },
  'Н75': { work: 750, full: 800 },
  'Н114': { work: 600, full: 646 },
  'МП-20': { work: 1100, full: 1150 },
  'МП-35': { work: 1035, full: 1076 },
  'Монтеррей': { work: 1100, full: 1180 },
  'Супермонтеррей': { work: 1100, full: 1180 },
  'Каскад': { work: 1020, full: 1115 },
  'Монтекристо': { work: 1100, full: 1200 },
  'Квинта': { work: 1100, full: 1210 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── Auth ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const body: NormalizeRequest = await req.json();
    const { op, organization_id } = body;
    const import_job_id = body.import_job_id as string | undefined;

    if (!op || !organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing op or organization_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify org membership
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[import-normalize] Op: ${op}, Org: ${organization_id}, Job: ${import_job_id || 'current'}`);

    // Quick ops that don't need bot_settings
    if (op === 'apply_status') {
      return new Response(
        JSON.stringify({ ok: true, state: 'DONE', progress: 100 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Load confirmed rules from bot_settings ──────────────
    const { data: botSettings } = await adminClient
      .from('bot_settings')
      .select('settings_json')
      .eq('organization_id', organization_id)
      .single();

    const settingsJson = (botSettings?.settings_json as Record<string, unknown>) || {};
    const pricingRules = (settingsJson.pricing as Record<string, unknown>) || {};
    const confirmedWidths = (pricingRules.widths_selected as Record<string, { work_mm: number; full_mm: number }>) || {};
    const profileAliases = (pricingRules.profile_aliases as Record<string, string>) || {};
    const coatingAliases = (pricingRules.coatings as Record<string, string>) || {};
    const colorRalAliases = ((pricingRules.colors as Record<string, unknown>)?.ral_aliases as Record<string, string>) || {};

    // =========================================================
    // DRY_RUN — Analyze staging rows, extract attributes via AI
    // =========================================================
    if (op === 'dry_run') {
      const jobId = import_job_id || 'current';
      const limit = Math.min((body.scope as Record<string, number>)?.limit || 500, 2000);
      const aiSuggest = body.ai_suggest !== false;

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 48000); // 48s safety margin

      try {

      // Load staging rows
      let query = adminClient
        .from('import_staging_rows')
        .select('id, row_number, data')
        .eq('organization_id', organization_id)
        .order('row_number', { ascending: true })
        .limit(limit);

      if (jobId !== 'current') {
        query = query.eq('import_job_id', jobId);
      }

      const { data: rows, error: rowsError } = await query;
      if (rowsError) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to load staging rows' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!rows || rows.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, stats: { rows_scanned: 0, candidates: 0, patches_ready: 0 }, patches_sample: [], questions: [] }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[import-normalize] Dry run: ${rows.length} rows loaded`);

      // Extract titles for AI analysis
      const titles = rows.map(r => {
        const d = r.data as Record<string, unknown>;
        return String(d.title || d['Наименование'] || d['Номенклатура'] || d.name || '');
      }).filter(t => t.length > 0);

      // Deduplicate titles before sending to AI
      const uniqueTitles = [...new Set(titles)];
      let aiPatches: Record<string, NormalizedAttributes> = {};

      if (aiSuggest && lovableApiKey && uniqueTitles.length > 0) {
        try {
          aiPatches = await normalizeWithAI(uniqueTitles, lovableApiKey, confirmedWidths, profileAliases, coatingAliases, colorRalAliases, ac.signal);
          console.log(`[import-normalize] AI returned ${Object.keys(aiPatches).length} patches`);
        } catch (aiErr) {
          if ((aiErr as Error).name === 'AbortError') {
            console.warn('[import-normalize] AI timed out, returning deterministic results only');
          } else {
            console.error('[import-normalize] AI error:', aiErr instanceof Error ? aiErr.message : aiErr);
          }
        }
      }

      // Also apply deterministic extraction for all titles
      const deterministicPatches: Record<string, Partial<NormalizedAttributes>> = {};
      for (const t of uniqueTitles) {
        deterministicPatches[t] = extractAttributesDeterministic(t, confirmedWidths, profileAliases, coatingAliases, colorRalAliases);
      }
      // Build patches — merge deterministic + AI (AI takes priority)
      const patches = rows.map(r => {
        const d = r.data as Record<string, unknown>;
        const title = String(d.title || d['Наименование'] || d['Номенклатура'] || d.name || '');
        const det = deterministicPatches[title] || {};
        const ai = aiPatches[title] || {};

        return {
          id: r.id,
          title,
          profile: ai.profile || det.profile || d.profile || null,
          thickness_mm: ai.thickness_mm || det.thickness_mm || d.thickness_mm || null,
          coating: ai.coating || det.coating || d.coating || null,
          color_code: ai.color_code || det.color_code || d.color_code || null,
          color_system: ai.color_system || det.color_system || d.color_system || null,
          width_work_mm: ai.width_work_mm || det.width_work_mm || d.width_work_mm || null,
          width_full_mm: ai.width_full_mm || det.width_full_mm || d.width_full_mm || null,
          price_rub_m2: parseFloat(String(d.price_rub_m2 || d['Цена'] || d.price || '0')) || 0,
          unit: ai.unit || det.unit || d.unit || 'm2',
          sheet_kind: ai.sheet_kind || det.sheet_kind || d.sheet_kind || 'OTHER',
          notes: d.notes || null,
        };
      });

      const readyCount = patches.filter(p => p.profile && p.thickness_mm && p.coating).length;

      return new Response(
        JSON.stringify({
          ok: true,
          run_id: `run_${Date.now()}`,
          stats: {
            rows_scanned: rows.length,
            candidates: uniqueTitles.length,
            patches_ready: readyCount,
          },
          patches_sample: patches.slice(0, 100),
          questions: [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

      } catch (dryErr) {
        if ((dryErr as Error).name === 'AbortError') {
          return new Response(
            JSON.stringify({ ok: false, code: 'TIMEOUT', error: 'Normalization timed out. Try with fewer rows.' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw dryErr;
      } finally {
        clearTimeout(timer);
      }
            patches_ready: readyCount,
          },
          patches_sample: patches.slice(0, 100),
          questions: [], // Questions will come from AI analysis gaps
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // APPLY — Write normalized data back to staging rows
    // =========================================================
    if (op === 'apply') {
      const runId = body.run_id as string;
      if (!runId) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing run_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Re-run normalization and write to staging
      const jobId = import_job_id || 'current';
      let query = adminClient
        .from('import_staging_rows')
        .select('id, row_number, data')
        .eq('organization_id', organization_id)
        .order('row_number', { ascending: true })
        .limit(2000);

      if (jobId !== 'current') {
        query = query.eq('import_job_id', jobId);
      }

      const { data: rows, error: rowsError } = await query;
      if (rowsError || !rows) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to load rows for apply' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Apply confirmed rules (deterministic, no AI needed)
      let updated = 0;
      for (const row of rows) {
        const d = row.data as Record<string, unknown>;
        const title = String(d.title || d['Наименование'] || d['Номенклатура'] || d.name || '');

        const attrs = extractAttributesDeterministic(title, confirmedWidths, profileAliases, coatingAliases, colorRalAliases);

        const updatedData = { ...d, ...attrs };

        await adminClient
          .from('import_staging_rows')
          .update({ data: updatedData })
          .eq('id', row.id);

        updated++;
      }

      console.log(`[import-normalize] Apply: updated ${updated} rows`);

      return new Response(
        JSON.stringify({
          ok: true,
          apply_id: runId,
          status: 'DONE',
          report: { updated },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // STATS — Quality metrics
    // =========================================================
    if (op === 'stats') {
      const jobId = import_job_id || 'current';
      let query = adminClient
        .from('import_staging_rows')
        .select('data')
        .eq('organization_id', organization_id)
        .limit(2000);

      if (jobId !== 'current') {
        query = query.eq('import_job_id', jobId);
      }

      const { data: rows } = await query;
      const total = rows?.length || 0;
      let profile_filled = 0, coating_filled = 0, color_code_filled = 0;
      let width_work_filled = 0, width_full_filled = 0, color_system_filled = 0;
      let kind_non_other = 0;

      for (const r of rows || []) {
        const d = r.data as Record<string, unknown>;
        if (d.profile) profile_filled++;
        if (d.coating) coating_filled++;
        if (d.color_code) color_code_filled++;
        if (d.width_work_mm) width_work_filled++;
        if (d.width_full_mm) width_full_filled++;
        if (d.color_system) color_system_filled++;
        if (d.sheet_kind && d.sheet_kind !== 'OTHER') kind_non_other++;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          metrics: { total, profile_filled, coating_filled, color_code_filled, width_work_filled, width_full_filled, color_system_filled, kind_non_other },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // DASHBOARD
    // =========================================================
    if (op === 'dashboard') {
      const jobId = import_job_id || 'current';
      let query = adminClient
        .from('import_staging_rows')
        .select('data')
        .eq('organization_id', organization_id)
        .limit(2000);

      if (jobId !== 'current') {
        query = query.eq('import_job_id', jobId);
      }

      const { data: rows } = await query;
      const total = rows?.length || 0;
      const ready = (rows || []).filter(r => {
        const d = r.data as Record<string, unknown>;
        return d.profile && d.thickness_mm && d.coating;
      }).length;

      return new Response(
        JSON.stringify({
          ok: true,
          organization_id,
          import_job_id: jobId,
          progress: {
            total,
            ready,
            needs_attention: total - ready,
            ready_pct: total > 0 ? Math.round((ready / total) * 100) : 0,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // apply_status handled early above

    // =========================================================
    // CONFIRM — Save a normalization rule via settings-merge
    // =========================================================
    if (op === 'confirm') {
      const type = body.type as string;
      const payload = body.payload as Record<string, unknown>;

      if (!type || !payload) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing type or payload for confirm' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Build pricing patch based on type
      const pricingPatch: Record<string, unknown> = {};

      switch (type) {
        case 'WIDTH_MASTER':
          pricingPatch.widths_selected = payload;
          break;
        case 'PROFILE_ALIAS':
          pricingPatch.profile_aliases = payload;
          break;
        case 'COATING_MAP':
          pricingPatch.coatings = payload;
          break;
        case 'COLOR_RAL':
          if (!pricingPatch.colors) pricingPatch.colors = {};
          (pricingPatch.colors as Record<string, unknown>).ral_aliases = payload;
          break;
        default:
          pricingPatch[type.toLowerCase()] = payload;
      }

      // Deep merge into bot_settings.settings_json.pricing
      const currentPricing = { ...pricingRules };
      for (const [k, v] of Object.entries(pricingPatch)) {
        if (typeof v === 'object' && v !== null && typeof currentPricing[k] === 'object') {
          currentPricing[k] = { ...(currentPricing[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
        } else {
          currentPricing[k] = v;
        }
      }

      const { error: updateErr } = await adminClient
        .from('bot_settings')
        .update({
          settings_json: { ...settingsJson, pricing: currentPricing },
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organization_id);

      if (updateErr) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to save rule' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, type, next_action: 'dry_run', affected_clusters: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // ANSWER_QUESTION — Apply a single answer
    // =========================================================
    if (op === 'answer_question') {
      const qType = body.question_type as string;
      const token = body.token as string;
      const value = body.value;

      // Save as confirmed rule
      const patchKey = qType === 'WIDTH' ? 'widths_selected' :
                       qType === 'COATING' ? 'coatings' :
                       qType === 'COLOR' ? 'colors' :
                       qType === 'PROFILE' ? 'profile_aliases' : qType.toLowerCase();

      const patch: Record<string, unknown> = {};
      if (qType === 'COLOR') {
        patch.colors = { ral_aliases: { [token]: value } };
      } else {
        patch[patchKey] = { [token]: value };
      }

      const updatedPricing = { ...pricingRules };
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === 'object' && v !== null && typeof updatedPricing[k] === 'object') {
          updatedPricing[k] = { ...(updatedPricing[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
        } else {
          updatedPricing[k] = v;
        }
      }

      await adminClient
        .from('bot_settings')
        .update({
          settings_json: { ...settingsJson, pricing: updatedPricing },
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organization_id);

      return new Response(
        JSON.stringify({ ok: true, type: qType, applied: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // TREE — Category tree
    // =========================================================
    if (op === 'tree') {
      const { data: rows } = await adminClient
        .from('import_staging_rows')
        .select('data')
        .eq('organization_id', organization_id)
        .limit(2000);

      const kindCounts: Record<string, number> = {};
      for (const r of rows || []) {
        const d = r.data as Record<string, unknown>;
        const kind = String(d.sheet_kind || 'OTHER');
        kindCounts[kind] = (kindCounts[kind] || 0) + 1;
      }

      const nodes = Object.entries(kindCounts).map(([kind, count]) => ({
        cat_tree: kind,
        cat_name: kind,
        parts: [kind],
        count,
      }));

      return new Response(
        JSON.stringify({ ok: true, organization_id, nodes }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // PREVIEW_ROWS
    // =========================================================
    if (op === 'preview_rows') {
      const limit = Math.min((body.limit as number) || 500, 2000);
      const offset = (body.offset as number) || 0;

      const { data: rows } = await adminClient
        .from('import_staging_rows')
        .select('id, row_number, data')
        .eq('organization_id', organization_id)
        .order('row_number', { ascending: true })
        .range(offset, offset + limit - 1);

      return new Response(
        JSON.stringify({
          ok: true,
          rows: (rows || []).map(r => ({ id: r.id, row_number: r.row_number, ...r.data as Record<string, unknown> })),
          total: rows?.length || 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================
    // CHAT — AI assistant with real data modification capabilities
    // =========================================================
    if (op === 'chat') {
      const message = body.message as string;
      if (!message || !lovableApiKey) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing message or AI not configured' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Load sample data for context
      const jobId = import_job_id || 'current';
      let sampleQuery = adminClient
        .from('import_staging_rows')
        .select('id, data')
        .eq('organization_id', organization_id)
        .limit(20);
      if (jobId !== 'current') sampleQuery = sampleQuery.eq('import_job_id', jobId);
      const { data: sampleRows } = await sampleQuery;

      const sampleTitles = (sampleRows || []).map(r => {
        const d = r.data as Record<string, unknown>;
        return String(d.title || d['Наименование'] || d['Номенклатура'] || '');
      }).filter(t => t.length > 0).slice(0, 10);

      // Build system prompt with real context
      const systemPrompt = `Ты — ИИ-ассистент по нормализации каталога кровельных материалов.

ТЕКУЩИЕ ПРАВИЛА ОРГАНИЗАЦИИ:
- Алиасы профилей: ${JSON.stringify(profileAliases)}
- Алиасы покрытий: ${JSON.stringify(coatingAliases)}
- Алиасы цветов: ${JSON.stringify(colorRalAliases)}
- Ширины: ${JSON.stringify(confirmedWidths)}

ПРИМЕРЫ ТОВАРОВ В ПРАЙСЕ:
${sampleTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

ВОЗМОЖНОСТИ:
1. Ответы на вопросы о данных в прайсе
2. Массовые обновления атрибутов через команды
3. Создание и обновление правил нормализации (алиасы)

Если пользователь просит изменить данные, верни JSON:
\`\`\`json
{"action":"update_rule","type":"COATING"|"COLOR"|"PROFILE"|"WIDTH","token":"MattPE","value":"Матовый полиэстер"}
\`\`\`

Если пользователь просит установить скидку, верни JSON:
\`\`\`json
{"action":"info","message":"Скидки настраиваются во вкладке «Скидки» каталога"}
\`\`\`

Если просто вопрос — отвечай текстом кратко и по делу.`;

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          temperature: 0.2,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: `AI error: ${response.status}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const aiResult = await response.json();
      const reply = aiResult.choices?.[0]?.message?.content || '';

      // Try to parse action commands from AI response
      const jsonMatch = reply.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          const cmd = JSON.parse(jsonMatch[1]);
          if (cmd.action === 'update_rule' && cmd.type && cmd.token && cmd.value) {
            // Apply the rule automatically
            const patchKey = cmd.type === 'COATING' ? 'coatings' :
                            cmd.type === 'COLOR' ? 'colors' :
                            cmd.type === 'PROFILE' ? 'profile_aliases' :
                            cmd.type === 'WIDTH' ? 'widths_selected' : cmd.type.toLowerCase();

            const updatedPricing = { ...pricingRules };
            if (cmd.type === 'COLOR') {
              const colors = (updatedPricing.colors as Record<string, unknown>) || {};
              const ralAliases = (colors.ral_aliases as Record<string, string>) || {};
              ralAliases[cmd.token] = cmd.value;
              updatedPricing.colors = { ...colors, ral_aliases: ralAliases };
            } else {
              const existing = (updatedPricing[patchKey] as Record<string, unknown>) || {};
              existing[cmd.token] = cmd.value;
              updatedPricing[patchKey] = existing;
            }

            await adminClient
              .from('bot_settings')
              .update({
                settings_json: { ...settingsJson, pricing: updatedPricing },
                updated_at: new Date().toISOString(),
              })
              .eq('organization_id', organization_id);

            const cleanReply = reply.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '').trim();
            return new Response(
              JSON.stringify({
                ok: true,
                reply: `✅ Правило сохранено: ${cmd.token} → ${cmd.value}\n\n${cleanReply || 'Выполните повторное сканирование для применения.'}`,
                rule_applied: { type: cmd.type, token: cmd.token, value: cmd.value },
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch {
          // Not a valid command JSON, return reply as-is
        }
      }

      return new Response(
        JSON.stringify({ ok: true, reply }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: `Unknown op: ${op}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[import-normalize] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── AI Normalization ───────────────────────────────────────

async function normalizeWithAI(
  titles: string[],
  apiKey: string,
  confirmedWidths: Record<string, { work_mm: number; full_mm: number }>,
  profileAliases: Record<string, string>,
  coatingAliases: Record<string, string>,
  colorAliases: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, NormalizedAttributes>> {
  // Process in batches of 30 titles (smaller = faster per call)
  const BATCH = 30;
  const allPatches: Record<string, NormalizedAttributes> = {};

  for (let i = 0; i < titles.length; i += BATCH) {
    if (signal?.aborted) break;

    const batch = titles.slice(i, i + BATCH);

    const prompt = `Извлеки атрибуты из названий кровельных товаров. Верни JSON массив:
[{"title":"...","profile":"С8"|null,"thickness_mm":0.5|null,"coating":"Полиэстер"|null,"color_code":"3005"|null,"color_system":"RAL"|null,"sheet_kind":"PROFNASTIL"|"METALLOCHEREPICA"|"OTHER","unit":"m2"|"sht"}]

Алиасы: профили=${JSON.stringify(profileAliases)}, покрытия=${JSON.stringify(coatingAliases)}

Названия:
${batch.map((t, idx) => `${idx + 1}. ${t}`).join('\n')}

Верни ТОЛЬКО JSON массив.`;

    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        console.error(`[import-normalize] AI batch error: ${response.status}`);
        continue;
      }

      const result = await response.json();
      let content = result.choices?.[0]?.message?.content || '';

      // Extract JSON
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) content = jsonMatch[1];

      const parsed = JSON.parse(content.trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const widths = getWidths(item.profile, confirmedWidths);
          allPatches[item.title] = {
            profile: item.profile || null,
            thickness_mm: item.thickness_mm || null,
            coating: item.coating || null,
            color_code: item.color_code || null,
            color_system: item.color_system || null,
            sheet_kind: item.sheet_kind || 'OTHER',
            width_work_mm: widths?.work || null,
            width_full_mm: widths?.full || null,
            unit: item.unit || 'm2',
          };
        }
      }
    } catch (parseErr) {
      console.error(`[import-normalize] AI parse error batch ${i}:`, parseErr);
    }
  }

  return allPatches;
}

// ─── Deterministic attribute extraction ─────────────────────

function extractAttributesDeterministic(
  title: string,
  confirmedWidths: Record<string, { work_mm: number; full_mm: number }>,
  profileAliases: Record<string, string>,
  coatingAliases: Record<string, string>,
  colorAliases: Record<string, string>,
): Partial<NormalizedAttributes> {
  const attrs: Partial<NormalizedAttributes> = {};
  const upper = title.toUpperCase();

  // Profile extraction
  const profilePatterns = [
    /\b(С-?8|C-?8)\b/i,
    /\b(С-?10|C-?10)\b/i,
    /\b(С-?20|C-?20)\b/i,
    /\b(С-?21|C-?21)\b/i,
    /\b(С-?44|C-?44)\b/i,
    /\b(НС-?35|HC-?35)\b/i,
    /\b(НС-?44|HC-?44)\b/i,
    /\b(Н-?57|H-?57)\b/i,
    /\b(Н-?60|H-?60)\b/i,
    /\b(Н-?75|H-?75)\b/i,
    /\b(Н-?114|H-?114)\b/i,
    /\b(МП-?20|MP-?20)\b/i,
    /\b(МП-?35|MP-?35)\b/i,
    /Монтеррей/i,
    /Супермонтеррей/i,
    /Каскад/i,
    /Монтекристо/i,
    /Квинта/i,
  ];

  const profileNames = ['С8', 'С10', 'С20', 'С21', 'С44', 'НС35', 'НС44', 'Н57', 'Н60', 'Н75', 'Н114', 'МП-20', 'МП-35', 'Монтеррей', 'Супермонтеррей', 'Каскад', 'Монтекристо', 'Квинта'];

  for (let i = 0; i < profilePatterns.length; i++) {
    if (profilePatterns[i].test(title)) {
      attrs.profile = profileNames[i];
      break;
    }
  }

  // Apply profile aliases
  if (!attrs.profile) {
    for (const [alias, canonical] of Object.entries(profileAliases)) {
      if (upper.includes(alias.toUpperCase())) {
        attrs.profile = canonical;
        break;
      }
    }
  }

  // Thickness
  const thicknessMatch = title.match(/(\d[.,]\d{1,2})\s*мм|толщ[а-я]*\s*(\d[.,]\d{1,2})/i);
  if (thicknessMatch) {
    attrs.thickness_mm = parseFloat((thicknessMatch[1] || thicknessMatch[2]).replace(',', '.'));
  }

  // Coating
  if (/полиэстер|PE\b/i.test(title)) attrs.coating = 'Полиэстер';
  else if (/пурал|pural/i.test(title)) attrs.coating = 'Пурал';
  else if (/оцинк|цинк|zn\b/i.test(title)) attrs.coating = 'Оцинковка';
  else if (/матов|matt/i.test(title)) attrs.coating = 'Матовый полиэстер';
  else if (/принтеч|printech/i.test(title)) attrs.coating = 'Printech';

  // Apply coating aliases
  if (!attrs.coating) {
    for (const [alias, canonical] of Object.entries(coatingAliases)) {
      if (upper.includes(alias.toUpperCase())) {
        attrs.coating = canonical;
        break;
      }
    }
  }

  // RAL color
  const ralMatch = title.match(/RAL\s*(\d{4})/i);
  if (ralMatch) {
    attrs.color_code = ralMatch[1];
    attrs.color_system = 'RAL';
  }

  // Apply color aliases
  if (!attrs.color_code) {
    for (const [alias, ral] of Object.entries(colorAliases)) {
      if (upper.includes(alias.toUpperCase())) {
        attrs.color_code = ral;
        attrs.color_system = 'RAL';
        break;
      }
    }
  }

  // Sheet kind
  if (attrs.profile) {
    const p = attrs.profile;
    if (/Монтеррей|Супермонтеррей|Каскад|Монтекристо|Квинта/i.test(p)) {
      attrs.sheet_kind = 'METALLOCHEREPICA';
    } else {
      attrs.sheet_kind = 'PROFNASTIL';
    }
  }

  // Widths
  const widths = getWidths(attrs.profile || null, confirmedWidths);
  if (widths) {
    attrs.width_work_mm = widths.work;
    attrs.width_full_mm = widths.full;
  }

  return attrs;
}

function getWidths(
  profile: string | null,
  confirmedWidths: Record<string, { work_mm: number; full_mm: number }>
): { work: number; full: number } | null {
  if (!profile) return null;

  // Check confirmed widths first
  if (confirmedWidths[profile]) {
    return { work: confirmedWidths[profile].work_mm, full: confirmedWidths[profile].full_mm };
  }

  // Fallback to reference table
  if (PROFILE_WIDTHS[profile]) {
    return PROFILE_WIDTHS[profile];
  }

  return null;
}
