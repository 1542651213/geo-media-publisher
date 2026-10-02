// Retired records from preserved local release history. SQL is not reapplied.
// Exact identities stay auditable; every other unknown migration is refused.
export const RETIRED_MIGRATION_PROVENANCE = [
  {
    "id": "0023_v150_one_shot_publication_authorization.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "0876825d0e393622b2c6a6f243a0fd075a602da0a3343c2464192c4f93d6386d"
  },
  {
    "id": "0024_v151_platform_account_identity_binding.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "33c357c22c265853b1baf33d6d04f6d547438d9aad8cccdbe290603f21a543f1"
  },
  {
    "id": "0025_v152_one_shot_content_binding.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "b46f9401f6130c6535b8a38633c6bca06e7028819ad902d40d05982a9c013d05"
  },
  {
    "id": "0026_submission_dispatch_barrier.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "c8328e837fa9cb657cc7ca34d329860b9d97fbe47ec9dd4d54692a963809d110"
  },
  {
    "id": "0027_immutable_content_snapshots.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "81708135f20e180d161e2df6850a37fd88f170479c0e8defb405c083886e98e6"
  },
  {
    "id": "0028_production_pilot_slots.sql",
    "sourceCommit": "5b1f3f62898815f2a245b72838f170ea5b270d8d",
    "sha256": "0ce5ed8a9c36f1a7eef8d896227502a6bb89a188cd6023246ac82f996e7178d8"
  },
  {
    "id": "0029_kangyi_durable_operation_metadata.sql",
    "sourceCommit": "c7130951782363f8d27941bd0153e95c266c8740",
    "sha256": "4d30ff8107a419f7f9dbf05f80c2bdcb177a2c0084a9672f69b0962caa5f7246"
  }
] as const;
