# FRONTEND ↔ EDGE Audit Matrix (PR1: shim/compat audit only)

## Scope
- Repo: **cloud-canvas** (frontend only).
- Audit target: frontend normalization flows vs `docs/EDGE_CONTRACTS.md` and live payload examples in `docs/EDGE_DEVTOOLS_PAYLOADS.md`.
- No functional fixes in this PR.

## Call matrix: UI action → function/hook → invoke → op → backend endpoint → request/response/error

| UI action | Function / hook | Edge call entrypoint | `op` | Edge → backend endpoint | Request shape from frontend | Response handling in frontend | Error handling in frontend |
|---|---|---|---|---|---|---|---|
| Wizard open (initial load) | `NormalizationWizard` `useEffect` → `fetchDashboard(effectiveJobId)` | `apiInvoke('import-normalize', body)` via `invokeOrThrow` | `dashboard` | `/api/enrich/dashboard` | `{ op:'dashboard', organization_id, import_job_id }` | Expects `ok:true`; stores `dashboardResult` | Logs warning, non-blocking (no toast) |
| Manual refresh (button "Сканировать") | `handleRunScan` → `fetchDashboard` + `startScan` | `apiInvoke('import-normalize', body)` | `dashboard` + `dry_run` | `/api/enrich/dashboard` + `/api/enrich/dry_run` | `dashboard`: same as above; `dry_run`: `{ op:'dry_run', organization_id, import_job_id, scope, ai_suggest }` | `dashboard`: updates cards/progress; `dry_run`: sets `run_id`, `profile_hash`, `questions`, `patches_sample` | `dry_run` timeout and contract errors surfaced via toast; `dashboard` is soft-fail |
| AI chat send message | `AIChatPanel` `chatMutation.mutationFn` | `apiInvoke('import-normalize', body)` | `ai_chat_v2` | `/api/enrich/ai_chat_v2` (fallback `/api/enrich/chat`) | `{ op:'ai_chat_v2', organization_id, import_job_id, run_id, message, context|null }` | Expects `assistant_message`, `actions[]`, `missing_fields`, `requires_confirm`; displays actions | Converts invoke error into `ok:false` chat message; timeout message handled in UI |
| Confirm from form: WIDTH | `NormalizationWizard.handleAnswerQuestion` | `confirmBatch` → `apiInvoke('import-normalize', body)` | `confirm` | `/api/enrich/confirm` | Action payload for width: `{ type:'WIDTH_MASTER', payload:{ profile, full_mm, work_mm? } }` | Expects `ConfirmResult ok:true`, may start polling if `apply_started` | Toast error on failure |
| Confirm from form: PROFILE/COLOR/COATING | `NormalizationWizard.handleAnswerQuestion` | `confirmBatch` → `apiInvoke('import-normalize', body)` | `confirm` | `/api/enrich/confirm` | Default payload: `{ type:'PROFILE_MAP'|'COATING_MAP'|'COLOR_MAP', payload:{ token, canonical } }` | Same as above | Same as above |
| Confirm from cluster quick action | `NormalizationWizard.handleAnswerFromCluster` | `confirmBatch` → `apiInvoke('import-normalize', body)` | `confirm` | `/api/enrich/confirm` | Always sends `{ token, canonical }` payload for all mapped types (incl `WIDTH_MASTER`) | Same as above | Same as above |
| Apply start | `useNormalization.executeApply` | `apiInvoke('import-normalize', body)` | `apply` | `/api/enrich/apply_start` then fallback `/api/enrich/apply` (inside Edge) | `{ op:'apply', organization_id, import_job_id, run_id, profile_hash }` | If `apply_id` returned → starts poll; else supports sync completion | Handles `PROFILE_HASH_MISMATCH`, `TIMEOUT`, contract errors |
| Apply status poll | `useNormalization.pollApplyStatus` (interval) | `apiInvoke('import-normalize', body)` | `apply_status` | `/api/enrich/apply_status` | `{ op:'apply_status', organization_id, import_job_id, apply_id, run_id }` | Normalizes status/phase/progress and transitions state machine | Stops after limits; fails after 3 consecutive polling errors |

## Focus check: where `WIDTH_MASTER`, `PROFILE_MAP`, `COATING_MAP`, `COLOR_MAP` are sent

| Sender path | Type mapping | Payload shape actually sent |
|---|---|---|
| `NormalizationWizard.handleAnswerQuestion` | `WIDTH -> WIDTH_MASTER` | `{ profile, full_mm, work_mm? }` |
| `NormalizationWizard.handleAnswerQuestion` | `PROFILE -> PROFILE_MAP` | `{ token, canonical }` |
| `NormalizationWizard.handleAnswerQuestion` | `COATING -> COATING_MAP` | `{ token, canonical }` |
| `NormalizationWizard.handleAnswerQuestion` | `COLOR -> COLOR_MAP` | `{ token, canonical }` |
| `NormalizationWizard.handleAnswerFromCluster` | `WIDTH/COATING/COLOR -> *_MAP/WIDTH_MASTER` | `{ token, canonical }` for all mapped types |
| `AIChatPanel.handleApplyActions` | passthrough `actions[].type` from AI | `payload` forwarded without frontend normalization |

## CorrelationId check (frontend)
- All normalization requests in current feature code go through `apiInvoke` / `invokeEdge` wrappers.
- `apiInvoke` injects `x-correlation-id` header on every call.
- No direct `supabase.functions.invoke(...)` usage found in `src/`.

## Browser secret headers check
- Browser call examples in DevTools payload doc show only `Authorization` + `Content-Type` for Edge requests.
- Internal secrets (`X-Internal-Secret`, `X-Import-Secret`) are edge-to-backend headers and are set inside Edge functions, not in frontend.
