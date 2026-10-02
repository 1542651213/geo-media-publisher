# R1.15-H credential recovery classification

The five unreadable records are **LEGACY_UNUSED_CREDENTIAL / RETIRED / RECOVERY_NOT_REQUIRED_FOR_CURRENT_RELEASE**. Their cryptographic failure cause remains **NATIVE_DECRYPT_FAILED_CAUSE_UNDETERMINED**. This classification proves current release impact; it does not claim the records were decrypted, repaired, or safely deletable.

## Evidence and impact

A closed, full, hash-verified private copy was opened with the G installed executable under the same Windows user. Main was paused before startup to install network denial; a restore marker disabled automatic execution before migrations. Main native SafeStorage read 26 records: 21 readable, 5 unreadable. Local State was included, encryption availability and an in-memory context round trip succeeded. No decrypted material left Main.

| Opaque record | Logical field | Platform namespace | Current release impact |
| --- | --- | --- | --- |
| C10 | origin | kangyi_website | Retired route; retained |
| C11 | siteId | kangyi_website | Retired route; retained |
| C12 | environment | kangyi_website | Retired route; retained |
| C13 | keyId | kangyi_website | Retired route; retained |
| C14 | secret | kangyi_website | Retired route; retained |

All five belong to one historical account. No current AI profile or setting references them. The account's two historical `AwaitingConfirmation` jobs remain intact; they have no SubmissionIntent, final-submit claim, PublishRecord or current OfficialAPI operation. The last recorded job creation was 2026-09-24. These are retained historical confirmation items, not resumable H operations.

The old account and platform still have enabled flags in historical data. Those flags were **not changed** and do not grant execution authority:

- `createRuntimeAdapterRegistry` registers no `kangyi_website` Adapter; reconciliation reports `not_implemented`.
- The product whitelist admits no ordinary or batch route for that alias.
- OfficialAPI requires exact `website` account identity and `account:<id>:website:<field>` keys, with no old-alias fallback.
- All batch gates remain OFF, including the normal Scheduler.

Current stored credentials for the ordinary Douyin, Website and Toutiao routes are readable. Current Website has two separate account configurations; none uses the failed namespace. Credential readability does not prove live authentication, publishing authorization, or Owner-confirmed company ownership.

`ACTIVE_CREDENTIAL_SAFETY_UNKNOWN = 0` for this audited reference graph. The actual H installation repeated the Main-only check during private-copy upgrade and restart: 21 readable / 5 unreadable, with the complete credential file unchanged. Restoring a separate pre-H copy and starting matching G gave the same result. The native failure could involve an older encryption context or damaged ciphertext; available evidence does not distinguish these and no stronger cause is asserted.

## Preservation and Owner action

Original production files and all five encrypted records remain byte-identical. No account assignment, credential rewrite, delete, key rotation, platform request or cloud request was made. Full private reference metadata, ciphertext hashes and closed backup remain outside the repository in restricted storage. Public documentation contains only anonymous record identifiers and nonsecret field/platform metadata.

The private media inventory independently found three retained historical test-media rows referencing two unavailable external images. This blocks a fully verified private snapshot and is reported as a Candidate limitation. It does not alter the credential classification or justify modifying either credentials or media history.

Owner can keep these historical records unchanged. Do not attempt to resume the retired jobs or copy their encrypted fields into current Website accounts. Any future use of this legacy route requires a separately authorized migration and normal secure credential provisioning. Current account ownership still requires explicit Owner review.

## Verification

`r115-h-credential-classification.test.ts` covers current format, missing Local State, different Windows-user copy context, unsupported legacy format, truncated/noncanonical records, invalid metadata, active recovery and incomplete/orphan reference evidence. `r115-h-retired-credential-scope.test.ts` exercises the actual runtime registry and exact OfficialAPI namespace. The focused security set passed 3 files / 15 tests.

The classifier is read-only and returns fixed metadata codes. Missing evidence remains UNKNOWN; native error messages and plaintext are never returned. Synthetic fixtures prove diagnostic handling, not recovery under another Windows user. Cross-user recovery and real platform/cloud validation remain NOT_RUN.
