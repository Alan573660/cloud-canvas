/**
 * Shared parsing utilities for import-parse Edge Function.
 *
 * Handles CSV, XLSX/XLS, and PDF table extraction.
 */

// ─── CSV Parser ─────────────────────────────────────────────

export function parseCsv(text: string, delimiter = ';'): { headers: string[]; rows: Record<string, string>[] } {
  // Auto-detect delimiter
  const firstLine = text.split('\n')[0] || '';
  if (!firstLine.includes(delimiter) && firstLine.includes(',')) delimiter = ',';
  if (!firstLine.includes(delimiter) && firstLine.includes('\t')) delimiter = '\t';

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Parse respecting quoted fields
  function splitRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitRow(lines[0]).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitRow(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').replace(/^["']|["']$/g, '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

// ─── XLSX/XLS Parser using SheetJS ──────────────────────────

export async function parseExcel(fileBytes: Uint8Array): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  // Dynamic import of SheetJS
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');

  const workbook = XLSX.read(fileBytes, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[firstSheetName];
  const jsonData: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (jsonData.length === 0) return { headers: [], rows: [] };

  // Find header row (first non-empty row)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const nonEmpty = jsonData[i].filter(c => String(c).trim() !== '').length;
    if (nonEmpty >= 2) {
      headerIdx = i;
      break;
    }
  }

  const headers = jsonData[headerIdx].map(h => String(h).trim());
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < jsonData.length; i++) {
    const values = jsonData[i];
    if (!values || values.every(v => String(v).trim() === '')) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = String(values[idx] ?? '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

// ─── PDF Table Extraction via Gemini Vision ─────────────────

/**
 * Extract table data from PDF using Gemini Vision API.
 * Sends PDF as base64 to Gemini and gets structured table data back.
 */
export async function parsePdfWithGemini(
  fileBytes: Uint8Array,
  lovableApiKey: string
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const base64 = btoa(String.fromCharCode(...fileBytes));

  const prompt = `Ты — парсер прайс-листов. Извлеки ВСЕ строки таблицы из этого PDF-документа.

ВАЖНО: Документ может быть сканом (изображение) или текстовым PDF. Извлеки данные в любом случае.

Верни результат СТРОГО в формате JSON:
{
  "headers": ["Наименование", "Цена", ...другие колонки],
  "rows": [
    {"Наименование": "...", "Цена": "...", ...},
    ...
  ]
}

Правила:
1. Сохрани ВСЕ строки таблицы, не пропускай.
2. Числа пиши как строки (например "1250.00").
3. Если таблица на нескольких страницах — объедини все строки.
4. Названия колонок бери из заголовка таблицы.
5. Если колонки: "Номенклатура"/"Наименование" и "Цена" — это обязательные поля.
6. НЕ добавляй комментарии, только JSON.`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:application/pdf;base64,${base64}` },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 100000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) throw new Error('AI rate limit exceeded. Please try again later.');
    if (response.status === 402) throw new Error('AI credits exhausted. Please add funds.');
    throw new Error(`Gemini PDF parse failed (${response.status}): ${errText.substring(0, 300)}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '';

  // Extract JSON from response (may be wrapped in ```json ... ```)
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  try {
    const parsed = JSON.parse(jsonStr.trim());
    const headers: string[] = parsed.headers || [];
    const rows: Record<string, string>[] = (parsed.rows || []).map(
      (row: Record<string, unknown>) => {
        const r: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          r[k] = String(v ?? '');
        }
        return r;
      }
    );
    return { headers, rows };
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON. Response: ${content.substring(0, 300)}`);
  }
}

// ─── File Requirements Validation ───────────────────────────

/**
 * Validate that the parsed data meets minimum requirements.
 * Returns error details if validation fails.
 */
export function validateParsedData(
  headers: string[],
  rows: Record<string, string>[]
): { ok: boolean; error?: string; error_code?: string; details?: Record<string, unknown> } {
  if (rows.length === 0) {
    return { ok: false, error: 'Файл не содержит строк данных', error_code: 'EMPTY_FILE' };
  }

  // Normalize header names for matching
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Check for mandatory columns: price + nomenclature
  const priceAliases = ['цена', 'price', 'цена за м2', 'цена руб', 'price_rub_m2', 'стоимость', 'цена, руб'];
  const nameAliases = ['наименование', 'номенклатура', 'название', 'name', 'title', 'товар', 'продукт', 'позиция'];

  const hasPrice = normalizedHeaders.some(h => priceAliases.some(a => h.includes(a)));
  const hasName = normalizedHeaders.some(h => nameAliases.some(a => h.includes(a)));

  const missing: string[] = [];
  if (!hasName) missing.push('Наименование/Номенклатура');
  if (!hasPrice) missing.push('Цена');

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Отсутствуют обязательные колонки: ${missing.join(', ')}`,
      error_code: 'MISSING_REQUIRED_COLUMNS',
      details: {
        detected_columns: headers,
        missing_required: missing,
        hint: 'Файл должен содержать колонки "Наименование" (или "Номенклатура") и "Цена".',
      },
    };
  }

  return { ok: true };
}

// ─── Column Auto-Mapping ────────────────────────────────────

interface ColumnMapping {
  name_column: string | null;
  price_column: string | null;
  sku_column: string | null;
  unit_column: string | null;
  other_columns: string[];
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {
    name_column: null,
    price_column: null,
    sku_column: null,
    unit_column: null,
    other_columns: [],
  };

  const lower = headers.map(h => h.toLowerCase().trim());

  for (let i = 0; i < headers.length; i++) {
    const h = lower[i];
    if (!result.name_column && (
      h.includes('наименование') || h.includes('номенклатура') ||
      h.includes('название') || h === 'name' || h === 'title' || h.includes('товар')
    )) {
      result.name_column = headers[i];
    } else if (!result.price_column && (
      h.includes('цена') || h.includes('price') || h.includes('стоимость')
    )) {
      result.price_column = headers[i];
    } else if (!result.sku_column && (
      h.includes('артикул') || h === 'sku' || h.includes('код') || h === 'id'
    )) {
      result.sku_column = headers[i];
    } else if (!result.unit_column && (
      h.includes('ед. изм') || h === 'unit' || h.includes('единица')
    )) {
      result.unit_column = headers[i];
    } else {
      result.other_columns.push(headers[i]);
    }
  }

  return result;
}
