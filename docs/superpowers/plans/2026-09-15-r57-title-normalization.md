# r57 retained-editor title normalization

## Goal

Allow the retained-editor completion gate to compare the prepared Article title against the editor readback using the same Xiaohongshu text normalization already used by browser readback, including fullwidth punctuation such as `｜`.

## Steps

1. Add a regression test showing normalized ASCII readback for a fullwidth bound title is accepted while genuinely different content remains blocked.
2. Share the existing editor text normalization helper with the retained-editor gate and normalize both comparison inputs.
3. Run focused tests, then repository validation and packaging.
4. Deploy the packaged r57 build, revalidate the existing explicit target and all pre-submit gates, and perform at most one final submit attempt.

## Safety

Use the existing Run, Job, Record, Authorization, BrowserSession, and one-shot state machine. Do not create replacement state. Once the durable mouse boundary starts, reconcile only and never retry.
