# Toutiao protocol fixtures

`mock-login-valid.json` and `mock-login-invalid.json` are synthetic contract fixtures. They are **not** captures of the creator backend and must never be labelled as real protocol fixtures.

Only a future capture from an app-owned, authorized Creator session may use `AUTHORIZED_SHADOW_CAPTURE`. Pass it through the strict allowlist validator before saving. Never place raw requests, responses, Cookie values, tokens, signatures, account identifiers or article content in this directory.
