# Task10T — Task10S Confirmation Integrity Design

## Goal

Make the Task10S one-shot confirmation migration-safe, exactly-once, atomic, and visibly failed without entering the Xiaohongshu browser or starting publication when confirmation setup fails.

## Scope

- Audit and harden discovery of `0023_v150_one_shot_publication_authorization.sql` from source through packaged startup resources.
- Apply confirmation persistence and authorization creation in one SQLite transaction.
- Treat the Task10S test run as the confirmation identity so duplicate requests are idempotent and cannot create another authorization or operation.
- Add an immediate Renderer in-flight guard and a visible, accurate authorization-creation error.
- Record migration and confirmation lifecycle markers without recording secrets.
- Preserve Task10R exploration and Task10S final-submit safety behavior.

## Data flow

1. Application startup resolves one migration directory and runs the existing ordered migration runner.
2. The runner emits discovery/apply/ready markers and applies 0023 exactly once on a database whose recorded version is 0022.
3. The Renderer uses a synchronous ref plus state to admit one confirmation call for a drawer/run.
4. The Main service validates the XHS account and run, then calls one repository transaction keyed by the test-run identity.
5. The repository transaction creates or returns the single `AUTHORIZED_UNUSED` authorization and updates `publish_confirmed_at` together. Any SQL failure rolls back both.
6. The service returns an idempotent result for a duplicate identity; it never starts browser work during the confirmation-persistence phase.
7. Renderer rejection remains in the drawer and renders “一次性发布授权创建失败，尚未进入发布流程。”; retry is allowed only when the response proves that no authorization, operation, or publication transaction exists.

## Safety invariants

- `platform_key = xiaohongshu` and the fixed Task10S account binding remain enforced.
- One confirmation identity maps to at most one authorization and one operation.
- `FINAL_SUBMIT_COUNT` remains zero in all offline tests and this task.
- A missing table, insert failure, constraint failure, or database exception leaves `publish_confirmed_at` unchanged and creates no authorization, operation, browser session, job, intent, record, or publication transaction.
- Existing production-domain rows are not edited by tests or implementation verification.

## Verification

- Repository tests cover 0022→0023 upgrade, idempotency, missing-table rollback, insert failure rollback, and unique authorization identity.
- Service/Renderer tests cover duplicate requests, in-flight suppression, accurate failure classification, and retry eligibility.
- Existing Task10R/Task10S publisher guard tests remain green.
- Run focused tests, full tests, typecheck, lint, and build before packaging.
- Package only the new `release-task10t-20260901-r1` output and verify the migration and safety markers statically.
