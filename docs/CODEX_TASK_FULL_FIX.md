# CODEX TASK: Full Frontend Fix — Edge Integration, Normalization, Import, Catalog

**Repo:** `Alan573660/cloud-canvas`  
**Branch:** `lovable-dev`  
**Target:** Create PR(s) against `lovable-dev`  
**Date:** 2026-03-03  
**Priority:** P0 — production blockers

---

## 0. ABSOLUTE CONSTRAINTS (DO NOT VIOLATE)

1. **NO DDL** — do not CREATE/ALTER/DROP any tables, types, enums, policies, triggers.
2. **NO RLS changes** — RLS is configured in Supabase; handle access issues in UI only.
3. **NO `service_role` in browser** — frontend uses `anon` key + Supabase Auth only.
4. **NO new columns/tables** — if a field is missing, skip or ask.
5. **NO hardcoded strings** — all UI text via i18n (`src/i18n/locales/ru.json`, `en.json`).
6. **Preserve existing behavior** — refactor, don't rewrite from scratch. Keep all exports and public interfaces stable.

---

## 1. ARCHITECTURE CONTEXT

### 1.1 API Layer

The project has a unified API client at `src/lib/api-client.ts`:

```
apiInvoke<TData>(functionName, payload, options?) → Promise<ApiInvokeResult<TData>>
invokeEdge<TData>(functionName, body, options?)  → Promise<TData>  (throws on error)
invokeNormalize<TData>(op, organizationId, params?, options?) → Promise<TData>
```

- `apiInvoke` returns `{ ok: true, data, correlationId }` or `{ ok: false, error, correlationId }`.
- `invokeEdge` is a throwing wrapper (backward compat).
- `invokeNormalize` is a convenience wrapper for `import-normalize` calls.
- All calls add `x-correlation-id` header automatically.
- HTTP 202 with payload is treated as success (for `import-publish`).

**Types:** `src/lib/contract-types.ts` — canonical types for all Edge contracts.  
**Error utils:** `src/lib/edge-error-utils.ts` — `ApiLayerError`, `ApiContractError`, `extractStatusCode`, `normalizeInvokeError`, `normalizeErrorFromData`.

### 1.2 Edge Functions (Supabase)

| Function | Purpose | Config |
|---|---|---|
| `catalog-proxy` | Proxies `/api/catalog/items` and `/api/catalog/facets` to Cloud Run `PRICING_API_SAAS_URL` | `verify_jwt = false` |
| `import-normalize` | Normalization ops: `dry_run`, `stats`, `dashboard`, `tree`, `confirm`, `apply`, `apply_status`, `ai_chat_v2`, `answer_question`, `preview_rows` | `verify_jwt = false` |
| `settings-merge` | Deep merge patches into `bot_settings.settings_json` | `verify_jwt = false` |
| `import-validate` | Validates uploaded price file, writes to `import_staging_rows` | `verify_jwt = false` |
| `import-publish` | Publishes validated data to BigQuery via GCP SA | `verify_jwt = false` |

### 1.3 Secrets (already configured in Supabase)

- `PRICING_API_SAAS_URL` — Cloud Run catalog/pricing API
- `CATALOG_ENRICHER_URL` — Cloud Run enricher for normalization
- `ENRICH_SHARED_SECRET` — shared secret for auth between Edge → Cloud Run
- `GCP_SERVICE_ACCOUNT_JSON` — for BigQuery writes
- `IMPORT_WORKER_URL` / `IMPORT_SHARED_SECRET` — for import worker
- `SUPABASE_SERVICE_ROLE_KEY` — for service-role operations in Edge Functions

---

## 2. TASK 1: Migrate all raw `supabase.functions.invoke` to `apiInvoke` / `invokeEdge` / `invokeNormalize`

### 2.1 Problem

21 direct calls to `supabase.functions.invoke` bypass the unified API layer, losing:
- Correlation IDs for debugging
- Unified error normalization
- HTTP 202 handling
- Consistent error types

### 2.2 Files to modify

#### A) `src/lib/catalog-api.ts` (2 calls)

**Current:** Lines 98-104 and 122-128 use raw `supabase.functions.invoke('catalog-proxy', { body: ... })`.

**Target:** Replace with `invokeEdge<CatalogItemsResponse>('catalog-proxy', { endpoint, organization_id, params })`.

```typescript
// BEFORE:
const { data, error } = await supabase.functions.invoke('catalog-proxy', {
  body: { endpoint: '/api/catalog/items', organization_id, params: proxyParams },
});
if (error) throw new Error(`Catalog proxy error: ${error.message}`);

// AFTER:
import { invokeEdge } from '@/lib/api-client';

const data = await invokeEdge<CatalogItemsResponse>('catalog-proxy', {
  endpoint: '/api/catalog/items',
  organization_id,
  params: proxyParams,
});
```

Do the same for `fetchCatalogFacets`. Remove `import { supabase }` if no longer needed.

#### B) `src/pages/products/ImportPriceDialog.tsx` (2 calls)

**File lines:** ~265 (`import-validate`) and ~354 (`import-publish`).

**Current:** Uses raw `supabase.functions.invoke(ImportGatewayApi.validate, { body: ... })` and `supabase.functions.invoke(ImportGatewayApi.publish, { body: ... })`.

**Target — validate (line ~265):**
```typescript
import { apiInvoke } from '@/lib/api-client';

const result = await apiInvoke<ValidateResponse>('import-validate', {
  organization_id: profile.organization_id,
  import_job_id: job.id,
  file_path: job.storagePath,
  file_format: job.fileFormat,
  mapping: mapping || null,
  options: { transform: { sanitize_id: true, normalize_price: true, trim_text: true } },
});

if (!result.ok) throw new Error(result.error.message);
const data = result.data;
```

**CRITICAL FIX — validation stats:**  
The current code reads `data.total_rows`, `data.valid_rows`, `data.invalid_rows` directly from the validate response (lines 306-309). Per contract, `import-validate` returns only `{ ok, import_job_id }`. Stats must be polled from `import_jobs` table.

Replace lines 306-312:
```typescript
// After successful validation, poll import_jobs for stats
if (data.ok) {
  const { data: jobRow } = await supabase
    .from('import_jobs')
    .select('total_rows, valid_rows, invalid_rows')
    .eq('id', data.import_job_id)
    .eq('organization_id', profile!.organization_id)
    .single();

  return {
    ...data,
    total_rows: jobRow?.total_rows || 0,
    valid_rows: jobRow?.valid_rows || 0,
    invalid_rows: jobRow?.invalid_rows || 0,
  };
}
```

**Target — publish (line ~354):**
```typescript
const result = await apiInvoke('import-publish', {
  organization_id: profile.organization_id,
  import_job_id: createdJob.id,
  file_path: createdJob.storagePath,
  file_format: createdJob.fileFormat,
  archive_before_replace: true,
  mapping: Object.keys(columnMapping).length > 0 ? columnMapping : null,
  options: { transform: { sanitize_id: true, normalize_price: true, trim_text: true } },
  allow_partial: true,
});

// apiInvoke already handles 202 as success
if (!result.ok) throw new Error(result.error.message);
```

#### C) `src/components/normalization/NormalizationDialog.tsx` (5 calls)

This file has its own parallel `apiInvoke` calls that duplicate logic from `useNormalization` hook.

**Lines ~125:** `apiInvoke('import-normalize', { op: 'dry_run', ... })`  
**Lines ~365:** `apiInvoke('settings-merge', { ... })`  
**Lines ~405:** `apiInvoke('import-normalize', { op: 'apply', ... })`  
**Lines ~422:** `apiInvoke('import-normalize', { op: 'apply_status', ... })`  

These calls are already using `apiInvoke` but have issues:
1. The `settings-merge` and `apply` calls had syntax errors (fixed in last diff but verify).
2. The `apply_status` polling loop (lines 420-438) is an **unsafe `while` loop** with no max-duration, no max-requests, no consecutive-error guard. It can hang forever.
3. The `apply_status` call is missing `run_id` in payload (Contract v1 requires both `apply_id` AND `run_id`).

**Fix the polling loop** — replace the while loop with the pattern from `useNormalization` hook (interval-based polling with limits):

```typescript
// Replace lines 418-438 with:
if (startData?.apply_id) {
  // Delegate to a safe polling helper
  const finalStatus = await pollApplyStatusSafe(
    startData.apply_id,
    runId || '',
    organizationId,
    importJobId || 'current',
  );
  if (finalStatus === 'FAILED') throw new Error('Apply failed');
}
```

Create a helper function (or extract from `useNormalization`):
```typescript
async function pollApplyStatusSafe(
  applyId: string,
  runId: string,
  organizationId: string,
  importJobId: string,
  maxDurationMs = 7 * 60 * 1000,
  maxRequests = 300,
  intervalMs = 3000,
): Promise<string> {
  const start = Date.now();
  let count = 0;
  let consecutiveErrors = 0;

  while (true) {
    await new Promise(r => setTimeout(r, intervalMs));
    count++;

    if (Date.now() - start > maxDurationMs || count > maxRequests) {
      throw new Error('Polling exceeded limits');
    }

    try {
      const result = await apiInvoke<{ status?: string; state?: string; error?: string }>('import-normalize', {
        op: 'apply_status',
        organization_id: organizationId,
        import_job_id: importJobId,
        apply_id: applyId,
        run_id: runId,
      });

      if (!result.ok) throw new Error(result.error.message);

      const status = (result.data.status || result.data.state || 'UNKNOWN').toUpperCase();
      consecutiveErrors = 0;

      if (status === 'DONE' || status === 'COMPLETED') return 'DONE';
      if (status === 'FAILED' || status === 'ERROR') return 'FAILED';
      // else continue polling (QUEUED, RUNNING, PENDING)
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error('Too many consecutive polling errors');
    }
  }
}
```

#### D) `src/components/normalization/AIChatPanel.tsx` (1 call)

**Line ~231:** Uses `op: 'chat'` — this is the **deprecated legacy endpoint**.

**Current:**
```typescript
const result = await apiInvoke<AIChatResponse>('import-normalize', {
  op: 'chat',
  organization_id: organizationId,
  import_job_id: importJobId || 'current',
  message: userMessage,
  context: activeGroup ? { ... } : null,
});
```

**Target:** Migrate to `op: 'ai_chat_v2'` with Contract v1 types:

```typescript
import type { AiChatV2Result } from '@/lib/contract-types';

const result = await apiInvoke<AiChatV2Result>('import-normalize', {
  op: 'ai_chat_v2',
  organization_id: organizationId,
  import_job_id: importJobId || 'current',
  run_id: runId,  // MUST pass run_id for context
  message: userMessage,
  context: activeGroup ? { ... } : null,
});
```

**Additionally, update the response handling:**

The current `AIChatResponse` interface expects `{ ok, message, patch, error }`.  
Contract v1 `AiChatV2Result` returns `{ ok, assistant_message, actions[], missing_fields?, requires_confirm?, error }`.

- Replace `data.message` → `data.assistant_message`
- Replace `data.patch` → render `data.actions[]` as "pending changes" list
- If `data.missing_fields` is present, show a warning and block confirm
- If `data.requires_confirm` is true, show a confirm button before executing actions
- If `data.ai_skip_reason` or `data.ai_disabled` is present, show fallback message

**IMPORTANT:** `AIChatPanel` must receive `runId` as a prop from its parent. Update `AIChatPanelProps`:
```typescript
interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  runId?: string;        // ADD THIS
  activeGroup: PatternGroup | null;
  onApplyPatch: (patch: AIGeneratedPatch) => void;
  onConfirmActions?: (actions: AiChatV2Action[]) => void;  // ADD THIS
}
```

Update all call sites that render `<AIChatPanel>` to pass `runId`.

#### E) `src/hooks/use-normalization.ts` — already using `apiInvoke`, no migration needed.

Verify that the following calls are correct (they are):
- `invokeOrThrow` and `invokeWithEnvelope` wrappers around `apiInvoke` ✓
- All `import-normalize` ops pass `organization_id` ✓
- `settings-merge` passes `organization_id` + `patch` ✓

**One fix needed:** Lines 220-226, `saveConfirmedSettings` wraps settings under `pricing`:
```typescript
patch: {
  pricing: settings,
},
```
This is correct per contract. No change needed.

---

## 3. TASK 2: Consolidate NormalizationDialog to use `useNormalization` hook

### 3.1 Problem

`NormalizationDialog.tsx` (615 lines) duplicates all the logic that exists in `useNormalization` hook (754 lines):
- Its own `dry_run` mutation
- Its own `settings-merge` calls
- Its own `apply` + `apply_status` polling (with bugs)
- Its own question parsing logic

This creates state duplication, inconsistent error handling, and maintenance burden.

### 3.2 Target

Refactor `NormalizationDialog.tsx` to use `useNormalization` hook:

```typescript
export function NormalizationDialog({ open, onOpenChange, organizationId, importJobId, onComplete }: Props) {
  const norm = useNormalization({ organizationId, importJobId });
  
  // Use norm.executeDryRun, norm.saveConfirmedSettings, norm.executeApply, etc.
  // Remove all duplicate state and logic
}
```

**Specifically:**
1. Remove local `dryRunMutation` — use `norm.executeDryRun()`
2. Remove local `handleApplyToGroup` settings-merge call — use `norm.saveConfirmedSettings()`
3. Remove local `handleComplete` with unsafe polling — use `norm.executeApply()`
4. Keep only UI-specific state: `activeGroup`, `activeCategory`, `searchQuery`, `page`, `chatOpen`, `aiEnabled`
5. Feed `norm.dryRunResult.patches_sample` to the table display
6. Feed `norm.dryRunResult.questions` to the groups sidebar

### 3.3 Preserve

- The `parseQuestionsToGroups` function can stay in `NormalizationDialog.tsx` as a local helper (it's UI-specific group mapping)
- All UI rendering stays the same
- All i18n keys stay the same

---

## 4. TASK 3: Fix `AIChatPanel` Contract Migration

### 4.1 Current State

- Uses deprecated `op: 'chat'` instead of `op: 'ai_chat_v2'`
- Custom `AIChatResponse` type doesn't match Contract v1
- Missing `run_id` in requests
- Response handling expects single `patch` instead of `actions[]`

### 4.2 Required Changes

See section 2.2.D above for the API call migration.

**UI Changes:**

1. When `actions[]` is returned, display them as a list of "Pending Changes":
```tsx
{actions.map((action, i) => (
  <div key={i} className="p-2 border rounded text-xs">
    <Badge>{action.type}</Badge>
    <pre className="mt-1">{JSON.stringify(action.payload, null, 2)}</pre>
  </div>
))}
```

2. Add a "Confirm All" button that calls `onConfirmActions(actions)`.

3. The parent (`NormalizationDialog` or `NormalizationWizard`) handles `onConfirmActions` by calling `norm.confirmActions(actions)`.

4. If `missing_fields` is present, show a warning badge and disable confirm.

5. If `requires_confirm` is false, auto-apply actions (call `onConfirmActions` immediately).

### 4.3 Files

- `src/components/normalization/AIChatPanel.tsx` — main changes
- `src/components/normalization/NormalizationDialog.tsx` — pass `runId` and `onConfirmActions` props
- `src/components/normalization/NormalizationWizard.tsx` — pass `runId` and `onConfirmActions` props (if it renders AIChatPanel)

---

## 5. TASK 4: Fix `catalog-api.ts` Error Handling

### 5.1 Problem

`src/lib/catalog-api.ts` throws raw `Error` with string messages. After migration to `invokeEdge`, errors will be `ApiLayerError` instances with structured `code`, `statusCode`, `details`.

### 5.2 Target

After migrating to `invokeEdge`, remove the manual error checking:

```typescript
// BEFORE:
if (error) throw new Error(`Catalog proxy error: ${error.message}`);
const result = data as CatalogItemsResponse & { ok?: boolean; error?: string };
if (result?.ok === false) throw new Error(result.error || 'Catalog proxy returned error');

// AFTER:
// invokeEdge already throws ApiLayerError on error or ok:false
const result = await invokeEdge<CatalogItemsResponse>('catalog-proxy', { ... });
// result is guaranteed to be the success data
return result;
```

---

## 6. TASK 5: i18n — Add Missing Keys

### 6.1 Hardcoded strings found

Search for all hardcoded Russian strings in:
- `src/hooks/use-normalization.ts` — multiple toast messages in Russian without i18n:
  - `'Таймаут'`, `'Попробуйте уменьшить лимит...'`
  - `'Настройки сохранены'`, `'pricing.* обновлены через deep merge'`
  - `'Ошибка stats'`, `'Ошибка загрузки дашборда'`, `'Ошибка загрузки дерева'`
  - `'Правило сохранено'`, `'Ошибка подтверждения'`
  - `'Правила применены'`, `'Нормализация завершена'`
  - `'Настройки изменились'`, `'Автоматически пересканируем каталог…'`
  - `'Ошибка анализа'`, `'Ошибка применения'`
  - `'Сначала выполните анализ'`
  - `'Задача не найдена. Попробуйте запустить заново.'`
  - `'Polling превысил лимит...'`

### 6.2 Target

Add all these strings as i18n keys to both `ru.json` and `en.json`. Use the `useTranslation` hook:

```typescript
// useNormalization needs to accept `t` function or use useTranslation internally
const { t } = useTranslation();
toast({ title: t('normalize.timeout', 'Таймаут'), ... });
```

**Note:** `useNormalization` is a hook and CAN use `useTranslation()` inside it.

Add keys under `normalize.*` namespace in both locale files.

---

## 7. TASK 6: Type Safety Fixes

### 7.1 `src/lib/contract-types.ts`

Already fixed: `ApiInvokeSuccess` has `error?: undefined`, `ApiInvokeFailure` has `data?: undefined`.

**Verify** that TypeScript narrowing works in all call sites:
```typescript
const result = await apiInvoke<Foo>(...);
if (result.ok) {
  result.data; // Foo — no TS error
} else {
  result.error; // ApiErrorInfo — no TS error
}
```

### 7.2 `src/hooks/use-normalization.ts`

Lines 381, 253, 280, 304 cast `data as ...` — these are safe because `invokeOrThrow` guarantees data is present. But add explicit generic types where possible:

```typescript
// BEFORE:
const data = await invokeOrThrow('import-normalize', { ... });
const result = data as { ok: boolean; metrics?: QualityMetrics; error?: string };

// AFTER:
interface StatsResult { ok: boolean; metrics?: QualityMetrics; error?: string }
const result = await invokeOrThrow<StatsResult>('import-normalize', { ... });
```

Do this for: `fetchStats`, `fetchDashboard`, `fetchTree`, `confirmQuestion`, `confirmActions`.

---

## 8. TASK 7: Clean up duplicate/legacy components

### 8.1 Two NormalizationWizard files

There are TWO files:
- `src/components/normalization/NormalizationWizard.tsx`
- `src/components/import/NormalizationWizard.tsx`

**Determine which is canonical** and remove the other. Update all imports.

Check `src/components/normalization/index.ts` — it exports from `./NormalizationWizard`.
Check `src/pages/products/ImportPriceDialog.tsx` line 33 — imports from `@/components/import/NormalizationWizard`.

**Resolution:** Keep `src/components/normalization/NormalizationWizard.tsx` as canonical. Update `ImportPriceDialog.tsx` to import from `@/components/normalization/NormalizationWizard`. Delete `src/components/import/NormalizationWizard.tsx` if it's just a re-export or older version.

### 8.2 Legacy `op: 'chat'` vs `op: 'ai_chat_v2'`

After migrating `AIChatPanel` to `ai_chat_v2`, verify no other file uses `op: 'chat'`. Search:
```
grep -r "op.*chat" src/ --include="*.ts" --include="*.tsx"
```

If only `AIChatPanel` used it, the migration is complete.

### 8.3 Legacy `answerQuestion` in `useNormalization`

The `answerQuestion` method (lines 583+) uses `op: 'answer_question'`. Per policy, `confirmActions(actions[])` is the canonical write path.

**Do NOT remove** `answerQuestion` yet — it may still be used by `NormalizationWizard`. But mark it as `@deprecated` and add a TODO:

```typescript
/**
 * @deprecated Use confirmActions(actions[]) instead.
 * Kept for backward compatibility with NormalizationWizard v1.
 */
const answerQuestion = useCallback(async (...) => { ... });
```

---

## 9. TASK 8: Verify Edge Function CORS and Auth

### 9.1 All Edge Functions have `verify_jwt = false` in `supabase/config.toml`

This means JWT is NOT verified at the gateway level. Each Edge Function must validate auth internally using `supabase.auth.getUser(token)`.

**Verify** that all 5 Edge Function `index.ts` files:
1. Extract the `Authorization` header from the request
2. Call `supabase.auth.getUser(token)` to validate
3. Return 401 if invalid
4. Check organization membership

**Files to check:**
- `supabase/functions/catalog-proxy/index.ts`
- `supabase/functions/import-normalize/index.ts`
- `supabase/functions/import-publish/index.ts`
- `supabase/functions/import-validate/index.ts`
- `supabase/functions/settings-merge/index.ts`

**Verify CORS headers** in all Edge Functions match the required set:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
```

And that all functions handle `OPTIONS` preflight:
```typescript
if (req.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}
```

---

## 10. TESTING CHECKLIST

After all changes, verify:

- [ ] `npm run build` (or `bun run build`) passes with zero errors
- [ ] `npm run typecheck` (or `bunx tsc --noEmit`) passes
- [ ] No `supabase.functions.invoke` calls remain in `src/` (search: `grep -r "supabase.functions.invoke" src/`)
- [ ] All `apiInvoke` / `invokeEdge` / `invokeNormalize` calls have proper generic types
- [ ] No `op: 'chat'` references remain (replaced with `ai_chat_v2`)
- [ ] No hardcoded Russian strings in hooks/components (all via i18n)
- [ ] `NormalizationDialog` uses `useNormalization` hook instead of duplicate logic
- [ ] `AIChatPanel` receives `runId` prop and sends it in requests
- [ ] `ImportPriceDialog` polls `import_jobs` for validation stats instead of reading from response
- [ ] All Edge Functions have proper CORS headers and auth validation

---

## 11. FILE IMPACT MATRIX

| File | Changes | Priority |
|---|---|---|
| `src/lib/catalog-api.ts` | Migrate 2 calls to `invokeEdge` | P0 |
| `src/pages/products/ImportPriceDialog.tsx` | Migrate 2 calls, fix validation stats polling | P0 |
| `src/components/normalization/NormalizationDialog.tsx` | Consolidate to `useNormalization`, fix unsafe polling | P0 |
| `src/components/normalization/AIChatPanel.tsx` | Migrate `chat` → `ai_chat_v2`, add `runId` prop, update response handling | P1 |
| `src/hooks/use-normalization.ts` | Add generic types, add i18n, deprecate `answerQuestion` | P1 |
| `src/lib/contract-types.ts` | Already fixed (verify) | P2 |
| `src/i18n/locales/ru.json` | Add ~20 normalization toast keys | P1 |
| `src/i18n/locales/en.json` | Add ~20 normalization toast keys (English) | P1 |
| `src/components/normalization/index.ts` | Update exports if files moved | P2 |
| `src/components/import/NormalizationWizard.tsx` | Evaluate: delete or keep as re-export | P2 |
| `supabase/functions/*/index.ts` | Verify CORS + auth (5 files) | P1 |

---

## 12. PR STRUCTURE (recommended)

### PR1: `fix/invoke-shim-migration`
- Migrate `catalog-api.ts` (2 calls)
- Migrate `ImportPriceDialog.tsx` (2 calls + stats polling fix)
- **Minimal, safe, isolated**

### PR2: `fix/normalization-dialog-consolidation`
- Refactor `NormalizationDialog.tsx` to use `useNormalization` hook
- Fix unsafe polling loop
- Pass `runId` to `AIChatPanel`

### PR3: `fix/ai-chat-v2-migration`
- Migrate `AIChatPanel` from `op: 'chat'` to `op: 'ai_chat_v2'`
- Update response handling for `actions[]`
- Add `onConfirmActions` prop

### PR4: `chore/i18n-type-safety-cleanup`
- Add i18n keys for all hardcoded Russian strings
- Add generic types to `useNormalization` invoke calls
- Deprecate `answerQuestion`
- Clean up duplicate `NormalizationWizard` files
- Verify Edge Function CORS/auth

---

## 13. REFERENCE DOCUMENTS

- `docs/EDGE_CONTRACTS.md` — Contract v1 specification
- `docs/EDGE_DEVTOOLS_PAYLOADS.md` — Real request/response examples
- `docs/NORMALIZATION_MASTER_SPEC.md` — Full normalization system spec
- `docs/ARCHITECTURE_OVERVIEW.md` — Project architecture
- `docs/INTEGRATION_POINTS.md` — Edge function integration map
- `src/lib/contract-types.ts` — Canonical TypeScript types
- `src/lib/api-client.ts` — Unified API layer implementation
- `src/lib/edge-error-utils.ts` — Error normalization utilities

---

## 14. EXPECTED OUTCOME

After all PRs are merged:

1. **Zero raw `supabase.functions.invoke`** calls in `src/` — all go through the unified API layer
2. **AI Chat** uses `ai_chat_v2` with proper `actions[]` rendering and `run_id` context
3. **NormalizationDialog** is thin UI shell delegating to `useNormalization` hook — no duplicate state or logic
4. **Import validation stats** are polled from DB, not read from response body
5. **Apply polling** has proper limits (7 min / 300 requests / 3 consecutive errors max)
6. **All UI strings** go through i18n
7. **TypeScript** compiles cleanly with proper generic types
8. **Build passes** with zero errors
