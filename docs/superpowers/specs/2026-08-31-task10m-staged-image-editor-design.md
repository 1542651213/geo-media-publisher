# Task 10M Staged Xiaohongshu Image Editor Design

## Goal

Make Xiaohongshu image-post navigation and preparation phase-aware: the pre-upload gate proves only that the canonical authenticated page has reached a stable image-post upload shell, while title/body/final-submit discovery happens only after an approved upload has completed.

## Constraints

- Preserve Task10I live-verified canonical Page, Context, mutex, heartbeat, and single Publish Note navigation behavior.
- Keep `IMAGE_POST_PRE_UPLOAD` and `IMAGE_POST_POST_UPLOAD_EDITOR` assertions separate.
- Treat a hidden enabled file input with one visible usable ancestor surface as a valid upload capability.
- Gate remains read-only: no upload, fill, keyboard input, draft save, settings mutation, or final submit.
- `preparePublish` may enter its existing upload mutation only after the pre-upload contract passes.
- All failures remain phase-specific and fail closed.
- Task10A final-submit counting uses explicit submit action markers only.
- No other platform adapter or production database changes.

## Design

`image-editor-discovery.ts` owns the shared DOM signal collection, strict phase classifier, pre-upload contract, and bounded post-upload readiness/inspection. The browser adapter invokes those contracts from the existing canonical-page operation. Gate returns a structured `PRE_UPLOAD` success with `POST_UPLOAD_CONTROLS_STATUS=NOT_APPLICABLE_BEFORE_UPLOAD`; `preparePublish` invokes the same pre-upload assertion, enters the mutation boundary, uploads through the existing approved mechanism, waits for a stable post-upload phase, then discovers the required controls before filling content.

The analyzer maps the new structured events and phase-aware failures without inferring submit activity from ordinary words such as publish, submit, click, or upload. Tests cover delayed readiness, strict phase transitions, hidden upload controls, all fail-closed control states, mutation boundaries, identity preservation, and zero side effects for Gate.
