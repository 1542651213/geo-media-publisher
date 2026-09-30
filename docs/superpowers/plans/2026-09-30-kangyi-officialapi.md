# R1.15-C Kangyi OfficialAPI execution plan

Authority: Owner attachment `GEO_R1_15_C_KANGYI_OFFICIAL_API_CODEX_TASK_FINAL.md` and explicit continuous-execution instruction. Canonical checkout only. Start `d2aa3c3f2c173c186c567421bbc4657ae32eec45`; branch `release/2026-09-30-r1.15-c-kangyi-officialapi`. No CMS/site code changes. No Douyin action. No Website enablement before actual staging, production and installed normal UI acceptance.

## Task 1: Current contract and safe connection

Read deployed health and current Kangyi handoff/OpenAPI/source. Compare archive `901e2ea7f97c451aa1efc5fdd7bbe53ec8f71aca`. Restore compatible CMS V2 signing/client, preserve exact bytes and disable automatic write retry. Add Main-only local credential-file import into existing SafeStorage, read-only OfficialAPI adapter/account capability validation and ordinary account UI. Renderer receives only metadata. Tests: exact signing, scope/environment mismatch, no transport write replay, secret-free responses, missing/decrypt-failed credentials, writes disabled.

## Task 2: Durable publishing and mapping

Reuse archived controlled-block parser/slug/content mapping, adapt to `website` platform and current ARTICLE/CASE schema. Add additive operation journal tied to existing Jobs, with exact request bodies/keys, immutable content/media/account scope. Keep existing SubmissionIntent/final counter/global gate. Prepare media/draft/update/validate; final publish only after atomic existing claim. Response uncertainty never creates a replacement object. Recovery obtains original remote identity read-only; absent identity remains NeedsReconciliation. Maintenance is scoped to created objects and separately confirmed; purge has explicit test-object ownership gate.

## Task 3: Normal UI and offline recovery

Account scope/health/writes labels; ARTICLE/CASE required fields and selected media; normal publish preparation/confirmation/result details. Test migrations on a protected production copy and isolated fixture data. Test restart after media/draft/accepted/pending, changed bindings, duplicate execution, API-confirmed Published with independent fidelity warning. Production records unchanged except additive migration through Main, authorized task-local objects and normal account configuration.

## Task 4: Installed candidate and live acceptance

Build isolated Candidate, verify package identities, use normal installed UI. Staging quota one ARTICLE plus one explicitly synthetic CASE; exact cleanup; one safe response-loss test with original identity. Do not proceed to production if recovery cannot prove no duplication. Production quota one labeled temporary acceptance object and independent media group; normal UI publish/restart/withdraw/restore/delete/restricted cleanup. Missing HMAC is an explicit Owner stop condition; do all independent safe connection work first and preserve this ledger.

## Task 5: Enable, regress, release and Git

Only after Task 4 PASS enable Website ordinary and retain batch OFF/Douyin ON/other gates. Run focused/full suite, typecheck/lint/build, secret scan and independent review. Build new department installer without replacing historical artifacts, verify installed UI/read/restart. Complete integration/recovery/site-template/release/root READY; commit/push private GitHub and tag only earned release.

## Review focus

Unknown publish without a saved remote job ID; no signed operation lookup endpoint is declared. Media uncertainty without media ID similarly requires an explicit safe recovery contract. These cases must not be disguised as a second publish. Capabilities returns contentKinds/limits/writesEnabled, no per-action permissions; purge is server permission controlled and cannot be inferred from writesEnabled. Deployed list accepts active/deleted, while inherited OpenAPI enum differs. Preserve exact scope and fail closed.

## Execution ledger

- Baseline verified clean and equal origin/main. Recovery branch created locally.
- Current Kangyi handoff repo HEAD a23600ac6ef792e743e255fac8509f085f1b27a3; deployed source declared 8ac541c5518e44e3b1f23c0b9d9169ba0d0460fd, package fcc39c01d38211ecde42c95665b1272f8773ab1efa3e7328988fe737cb208406. These are handoff assertions pending independent authenticated live scope verification.
- Both live health endpoints HTTP200/protocol2. Unauthenticated capabilities HTTP401. Existing historical encrypted Kangyi credential fails current-user decryption. Safe local credential request pending; no remote write, no production DB write.
- Task 1 complete: strict Main file import/metadata UI and generic read-only connection Adapter. Review added exact-scope preflight, atomic SafeStorage bundle, transactional account configuration and post-await state/credential checks. Focused 48/48, full173files1201/1201, typecheck/lint/build PASS. Installed explicit isolated connection fixture import/restart/no-secret/no-Job smoke PASS. Package bytes match latest built Main/preload/Renderer. Production DB+credentials size/mtime/hash unchanged.
- Tasks 2–5 remain pending at genuine HMAC stop. Department Release not built; Website ordinary/batch OFF. Private push not attempted: actual GitHub repository PUBLIC, awaiting private destination/visibility authorization. Detailed accurate not-ready fields and connection Candidate identities in docs/releases/R1.15-C-READY.md.
