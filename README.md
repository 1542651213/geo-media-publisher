# Geo Media Publisher — Public Candidate Snapshot

This branch is a sanitized, source-only snapshot of a Windows Electron publishing workspace. It deliberately excludes local production records, profiles, credentials, historical operational notes, and owner-specific pilot configurations.

The accompanying GitHub Release asset is an unsigned candidate package. It is **not production-ready**: the ordinary Xiaohongshu final-submit flow preserves an uncertain result until a reviewed platform receipt contract is connected, so this candidate must not be used for a real final submission.

To run the source locally, install the locked pnpm dependencies, then use `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the relevant focused tests. Live platform operations require an external, owner-controlled configuration; no account identity, content, deadline, package hash, or authorization value is stored in this public snapshot.
