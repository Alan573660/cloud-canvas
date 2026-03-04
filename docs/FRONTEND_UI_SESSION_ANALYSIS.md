# FRONTEND UI Session Analysis (auth walkthrough)

## FACTS
1. Session context validated: repo `cloud-canvas`, branch `work`, `docs/EDGE_CONTRACTS.md` present.
2. Login page is available at `/login` in local dev run.
3. Authentication with provided user credentials succeeded and redirected to `/dashboard`.
4. Core sidebar routes are reachable in authenticated state:
   - `/dashboard`, `/contacts`, `/companies`, `/leads`
   - `/orders`, `/invoices`, `/products`, `/email`
   - `/calls`, `/billing`, `/analytics`, `/import`, `/settings`
5. Route-level smoke check showed expected section headings (e.g. `Dashboard`, `Contacts`, `Orders`, `Прайс и каталог`, `Data Import`, `Settings`).
6. In `/products`, quick actions and tabs are rendered; visible controls include `Загрузить прайс`, `Проверить цену`, `Создать скидку`, tabs `Товары / Discounts / Импорт / Normalization`.

## RISKS
1. Normalization UX entrypoint is not reliably discoverable from the current `/products` interaction in this session: visible `Normalization` tab/control did not open modal/wizard via straightforward button-role interactions.
2. Route smoke checks were completed, but deep workflow validation (full click-through inside normalization wizard with long polling/apply) is partially blocked by discoverability/entrypoint constraints in this local UI state.
3. Browser automation timed out when trying to run a single long route sweep; analysis was split into smaller batches.

## PLAN PR1..PR4
- **PR1:** audit matrix and risks documentation (already done).
- **PR2:** confirm payload guardrails and required-field checks (already done).
- **PR3:** UX + polling stability improvements (already done).
- **PR4:** deep end-to-end workflow validation artifacts (normalization wizard full path + apply/poll traces + captured payload diffs) once entrypoint path is explicit in UI or test fixture.

## WHAT I NEED FROM ALAN
1. Exact UI path (button/route) that should open the normalization wizard in current build (`/products` vs import-flow wrapper).
2. Preferred org/job fixture for deterministic normalization demo (so `Сканировать`/`Применить` scenarios are reproducible).
3. Confirmation whether role-based feature flags affect visibility of normalization controls for this account.

## BLOCKERS
1. In this local session, I could authenticate and navigate all main routes, but I could not consistently open the deep normalization modal via visible controls.
2. Full deep click-through (all internal wizard actions) therefore remains partially blocked by UI discoverability in this environment.

---

## Route smoke-check table (Expected vs Actual)

| Route | Expected | Actual | Status |
|---|---|---|---|
| `/dashboard` | Dashboard summary | Heading `Dashboard` rendered | MATCH |
| `/contacts` | Contacts workspace | Heading `Contacts` rendered | MATCH |
| `/companies` | Companies workspace | Heading `Companies` rendered | MATCH |
| `/leads` | Leads workspace | Heading `Leads` rendered | MATCH |
| `/orders` | Orders workspace | Heading `Orders` rendered | MATCH |
| `/invoices` | Invoices workspace | Heading `Invoices` rendered | MATCH |
| `/products` | Product catalog/import workspace | Heading `Прайс и каталог` rendered | MATCH |
| `/email` | Email workspace | Heading `Email` rendered | MATCH |
| `/calls` | Calls workspace | Heading `Calls` rendered | MATCH |
| `/billing` | Billing workspace | Heading `Billing` rendered | MATCH |
| `/analytics` | Analytics workspace | Heading `Analytics` rendered | MATCH |
| `/import` | Import page | Heading `Data Import` rendered | MATCH |
| `/settings` | Settings page | Heading `Settings` rendered | MATCH |

---

## Artifacts (screenshots)
- `browser:/tmp/codex_browser_invocations/460caf81895eca71/artifacts/artifacts/ui-after-login.png`
- `browser:/tmp/codex_browser_invocations/e3c2994245f086a2/artifacts/artifacts/routes-batch1.png`
- `browser:/tmp/codex_browser_invocations/cb2748c0760af926/artifacts/artifacts/routes-batch2.png`
- `browser:/tmp/codex_browser_invocations/411c5a2c74a7154b/artifacts/artifacts/routes-batch3a.png`
- `browser:/tmp/codex_browser_invocations/fcfa5e212437e477/artifacts/artifacts/routes-batch3b.png`
- `browser:/tmp/codex_browser_invocations/2fe24baa06a1173c/artifacts/artifacts/products-normalization.png`

## Commands/checks used
- `npm run dev -- --host 0.0.0.0 --port 4173`
- Browser automation via `run_playwright_script` (login + route walkthrough + screenshots)
- `rg -n "CRM|Orders|Catalog|Communications|Finance|Import|dashboard" src`
- `sed -n '1,220p' src/components/layout/AppLayout.tsx`
- `sed -n '1,260p' src/components/layout/AppSidebar.tsx`
