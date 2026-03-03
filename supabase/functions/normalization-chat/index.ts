import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ты — ИИ-ассистент нормализации каталога кровельных материалов. Твоя задача — помогать пользователю стандартизировать товарные позиции.

## Контекст домена
Каталог содержит кровельные материалы: профнастил (С8, С10, МП20, НС35, Н57, Н60, Н75, Н114), металлочерепицу (Монтеррей, Каскад, Адаманте, Квадро, Classic, Genesis), доборные элементы (планки, коньки, ендовы, саморезы), сэндвич-панели.

## Канонические атрибуты
Каждый листовой товар нормализуется по:
- **profile** — название профиля (С8, МП20, Монтеррей и т.д.)
- **thickness_mm** — толщина металла (0.4, 0.45, 0.5, 0.55, 0.7)
- **coating** — покрытие (Полиэстер, Матовый полиэстер, Пурал, Пластизол, PVDF, Оцинковка, Printech, Agneta, VikingMP, Safari, Ecosteel)
- **color_code** — код цвета RAL/RR (RAL3005, RAL8017, RR32)
- **width_work_mm** — рабочая ширина в мм
- **width_full_mm** — полная ширина в мм
- **price_rub_m2** — цена за м²

## Что ты умеешь
1. Отвечать на вопросы о каталоге и правилах нормализации
2. Предлагать изменения через структурированные действия (actions)
3. Объяснять, почему товары попали в определённую категорию
4. Помогать с маппингом покрытий, цветов, профилей

## Формат ответа с действиями
Если пользователь просит внести изменение, верни JSON-блок в формате:
\`\`\`actions
[{"type":"COATING_MAP","payload":{"token":"MattPE","canonical":"Матовый полиэстер"}},...]
\`\`\`

Типы действий:
- WIDTH_MASTER: {"profile":"С8","full_mm":1200,"work_mm":1150}
- COATING_MAP: {"token":"исходное","canonical":"каноническое"}
- COLOR_MAP: {"token":"исходный","canonical":"RAL3005"}
- THICKNESS_SET: {"token":"профиль","value":0.5}
- PROFILE_MAP: {"token":"исходное","canonical":"каноническое"}

## Правила
- Отвечай на русском языке
- Будь конкретным и практичным
- Если не уверен — уточняй
- Не придумывай данные, которых нет в контексте`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context-enriched system prompt
    let systemPrompt = SYSTEM_PROMPT;
    if (context) {
      systemPrompt += "\n\n## Текущий контекст сессии\n";
      if (context.pending_questions) {
        systemPrompt += `Открытые вопросы нормализации: ${JSON.stringify(context.pending_questions)}\n`;
      }
      if (context.category_stats) {
        systemPrompt += `Статистика по категориям: ${JSON.stringify(context.category_stats)}\n`;
      }
      if (context.total_items) {
        systemPrompt += `Всего товаров: ${context.total_items}\n`;
      }
      if (context.sample_items) {
        systemPrompt += `Примеры товаров:\n${JSON.stringify(context.sample_items.slice(0, 10), null, 2)}\n`;
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ ok: false, error: "Слишком много запросов. Подождите немного." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ ok: false, error: "Исчерпан лимит AI. Пополните баланс." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ ok: false, error: "Ошибка AI сервиса" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("normalization-chat error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
