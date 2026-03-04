# FRONTEND EDGE Audit — RISKS (PR1 only, no fixes)

## FACTS
1. Frontend normalization feature currently routes calls via `apiInvoke` / `invokeEdge`, where `apiInvoke` auto-adds `x-correlation-id` header.
2. Dashboard load/refresh uses `op: 'dashboard'` (plus `dry_run` on refresh path).
3. AI chat send uses `op: 'ai_chat_v2'` and frontend supports error envelope rendering.
4. Apply flow is async-first: frontend calls `op: 'apply'`, then polls `op: 'apply_status'`.
5. There are two payload builders for confirm actions:
   - form-based confirm (`handleAnswerQuestion`)
   - cluster quick confirm (`handleAnswerFromCluster`)
6. `WIDTH_MASTER` payload shape is not uniform across these two senders.

---

## RISKS

### R1 — `WIDTH_MASTER` can be sent without `payload.profile`
**Evidence (code):**
- Form path explicitly builds `WIDTH_MASTER` payload with `profile` and numeric fields (`src/components/normalization/NormalizationWizard.tsx:795-835`).
- Cluster quick path sends generic payload `{ token, canonical }` for all mapped types, including `WIDTH_MASTER` (`src/components/normalization/NormalizationWizard.tsx:857-873`).

**Evidence (contract/live payload docs):**
- Contract examples for WIDTH question emphasize profile-based width confirmation in question data and wording (`docs/EDGE_CONTRACTS.md`, section 1.1 dry_run WIDTH_MASTER examples).
- Live payload examples include WIDTH question with `profile` semantics in question and settings (`docs/EDGE_DEVTOOLS_PAYLOADS.md`, dry_run + settings-merge examples).

**Risk statement:**
- Same logical user action "confirm width" may emit different payload contracts depending on UI entrypoint. This creates contract ambiguity and backend-dependent behavior.

---

### R2 — Confirm payload schema for `PROFILE_MAP` / `COATING_MAP` / `COLOR_MAP` is weakly constrained
**Evidence (code):**
- `ConfirmAction.payload` is `Record<string, unknown>` (no strict per-type shape) (`src/lib/contract-types.ts`, confirm-related types).
- Form and cluster paths send generic `{ token, canonical }` for multiple confirm types (`src/components/normalization/NormalizationWizard.tsx:847-873`).
- AI chat confirm applies passthrough actions from model output without frontend schema normalization (`src/components/normalization/AIChatPanel.tsx:230-238`).

**Risk statement:**
- Frontend accepts and forwards heterogeneous action payloads, increasing chance of shape drift against backend expectations for each action type.

---

### R3 — Legacy dialog path duplicates apply/apply_status orchestration
**Evidence (code):**
- `NormalizationDialog` has its own apply start + manual polling loop (`src/components/normalization/NormalizationDialog.tsx:392-470`).
- Main flow already implements apply and polling in `useNormalization` (`src/hooks/use-normalization.ts:359-436`, `:509-560`).

**Risk statement:**
- Multiple orchestration implementations increase divergence risk in timeout/retry/status normalization behavior.

---

### R4 — Browser secret headers policy must remain enforced (currently compliant)
**Evidence (contract + live network docs):**
- Contract explicitly states browser must not send internal secret headers (`docs/EDGE_CONTRACTS.md:514-521`).
- Live DevTools request headers show browser sends `Authorization` and `Content-Type` only (`docs/EDGE_DEVTOOLS_PAYLOADS.md:13-16`).
- Internal secrets are attached inside Edge functions (`supabase/functions/import-normalize/index.ts:256-261`).

**Risk statement:**
- Any future direct browser integration with Cloud Run endpoints or custom header injection would violate current security contract.

---

## PLAN PR1..PR4
- **PR1 (this PR):** shim/compat audit artifacts only (`MATRIX` + `RISKS`), no behavior changes.
- **PR2:** unify frontend invoke layer usage and freeze allowed entrypoints (`apiInvoke/invokeEdge` only).
- **PR3:** define strict per-action payload guards (`WIDTH_MASTER`, `PROFILE_MAP`, `COATING_MAP`, `COLOR_MAP`) before send.
- **PR4:** consolidate normalization flows to single apply/poll implementation and enforce correlation tracing checks.

---

## WHAT I NEED FROM ALAN
1. Confirm canonical backend payload contract for each confirm action type (`WIDTH_MASTER`, `PROFILE_MAP`, `COATING_MAP`, `COLOR_MAP`) based on `supabase/functions/*` + Cloud Run implementation.
2. Confirm whether `run_id` in `apply_status` request is required or optional in backend contract.
3. Confirm whether legacy `NormalizationDialog` path is still in active product use or can be deprecated in later PRs.

---

## BLOCKERS
- No direct runtime DevTools session in this PR environment; "live payload" validation is based on committed `docs/EDGE_DEVTOOLS_PAYLOADS.md` snapshots.
- Cross-repo backend code (`maxim-saas`) is out of scope in this frontend-only PR.

---

## Expected vs Actual (audit snapshot)

| Scenario | Expected (contract/docs) | Actual (frontend behavior) | Status |
|---|---|---|---|
| dashboard load/refresh | `op: dashboard` returns `ok:true` data envelope | Implemented via `fetchDashboard`; errors are non-blocking | MATCH |
| AI chat send | `op: ai_chat_v2` with `message/context`; returns `assistant_message + actions[]` | Implemented in `AIChatPanel` and `useNormalization.sendAiChatV2` | MATCH |
| confirm WIDTH_MASTER | Consistent width payload semantics (profile + width fields) | Form path sends `profile/full_mm/work_mm`; cluster path can send `token/canonical` | MISMATCH (R1) |
| apply_start/apply_status poll | `apply` then `apply_status` polling with normalized statuses | Implemented in hook; duplicated in legacy dialog | PARTIAL MISMATCH (R3) |
| correlationId on calls | `x-correlation-id` on every frontend→edge call | Injected in `apiInvoke`; no direct `supabase.functions.invoke` in `src` | MATCH |
| secret headers in browser | Browser must not send `X-Internal-Secret` / `X-Import-Secret` | No such headers in frontend calls; secrets are edge-side only | MATCH |

---

## Frontend files audited in this PR
- `src/lib/api-client.ts`
- `src/hooks/use-normalization.ts`
- `src/hooks/use-normalization-flow.ts`
- `src/components/normalization/NormalizationWizard.tsx`
- `src/components/normalization/AIChatPanel.tsx`
- `src/components/normalization/NormalizationDialog.tsx`
- `src/lib/contract-types.ts`
- `docs/EDGE_CONTRACTS.md`
- `docs/EDGE_DEVTOOLS_PAYLOADS.md`

## Commands / checks used
- `git status --short`
- `git branch --show-current`
- `rg -n "supabase\.functions\.invoke|apiInvoke|invokeEdge|WIDTH_MASTER|PROFILE_MAP|COATING_MAP|COLOR_MAP|apply_start|apply_status|correlationId|chat" src docs supabase/functions`
- `rg -n "supabase\.functions\.invoke\(" src`
- `rg -n "Internal-Secret|Import-Secret|X-Internal|X-Import|x-internal|x-import" src docs supabase/functions`
- `sed -n ...` / `nl -ba ...` targeted reads for evidence
