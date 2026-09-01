import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH } from "@publisher/domain";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "task10v-identity-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  return database;
}

function insertAuthorization(database: ReturnType<typeof fixture>, input: { accountId: string; operationId: string; createdAt: string; state?: string; publicationTransactionCount?: number; finalSubmitAttemptCount?: number }) {
  const state = input.state ?? "AUTHORIZED_UNUSED";
  database.db.prepare(`INSERT INTO one_shot_publication_authorizations (
    id, authorization, platform_key, account_id, operation_id, mode, state,
    publication_transaction_count, publication_commit_action_count, final_submit_attempt_count,
    final_submit_retry_count, final_submit_action_started, final_submit_action_completed,
    created_at, updated_at, consumed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, NULL)`).run(
    `${input.operationId}-authorization`, OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, "xiaohongshu", input.accountId,
    input.operationId, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, state, input.publicationTransactionCount ?? 0,
    input.finalSubmitAttemptCount ?? 0, input.createdAt, input.createdAt
  );
}

describe("Task10V platform account identity binding schema", () => {
  it("creates the identity binding table and unique indexes", () => {
    const database = fixture();
    const table = database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_account_identity_bindings'").get();
    const indexes = database.db.prepare("SELECT name,\n       CASE WHEN sql LIKE 'CREATE UNIQUE INDEX%' THEN 1 ELSE 0 END AS unique_index\n       FROM sqlite_master WHERE type='index' AND tbl_name='platform_account_identity_bindings'").all() as Array<{ name: string; unique_index: number }>;
    const columns = database.db.prepare("PRAGMA table_info(platform_account_identity_bindings)").all() as Array<{ name: string }>;

    expect(table).toBeTruthy();
    expect(indexes).toEqual(expect.arrayContaining([
      { name: "uq_platform_account_identity_bindings_account", unique_index: 1 },
      { name: "uq_platform_account_identity_bindings_external", unique_index: 1 }
    ]));
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "id", "platform_key", "account_id", "external_creator_id", "display_name", "profile_url",
      "binding_source", "bound_at", "created_at", "updated_at"
    ]));
  });

  it("persists an identity binding once and rejects a conflicting overwrite", () => {
    const database = fixture();
    const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10V identity account" });
    const binding = {
      platformKey: "xiaohongshu" as const,
      accountId: account.id,
      externalCreatorId: "960803317",
      displayName: "测试账号",
      profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317",
      bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" as const
    };

    const first = database.repository.bindPlatformAccountIdentity(binding);
    expect(first.externalCreatorId).toBe("960803317");
    expect(database.repository.bindPlatformAccountIdentity(binding).id).toBe(first.id);
    expect(() => database.repository.bindPlatformAccountIdentity({ ...binding, externalCreatorId: "other-creator" })).toThrow(/绑定|conflict|mismatch/iu);
  });

  it("retains the newest reusable authorization and supersedes the older one", () => {
    const database = fixture();
    const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10V authorization account" });
    const oldRun = database.repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    const newRun = database.repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    insertAuthorization(database, { accountId: account.id, operationId: oldRun.testRunId, createdAt: "2026-09-01T07:27:48.460Z" });
    insertAuthorization(database, { accountId: account.id, operationId: newRun.testRunId, createdAt: "2026-09-01T07:28:28.266Z" });

    const result = database.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });

    expect(result.reusableOperationId).toBe(newRun.testRunId);
    expect(result.supersededOperationIds).toEqual([oldRun.testRunId]);
    expect(result.activeUnusedAuthorizationCount).toBe(1);
    expect(result.mutationCount).toBe(1);
    expect(database.repository.getOneShotPublicationAuthorization(oldRun.testRunId)?.state).toBe("SUPERSEDED_UNUSED");
    expect(database.repository.getOneShotPublicationAuthorization(newRun.testRunId)?.state).toBe("AUTHORIZED_UNUSED");

    const second = database.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    expect(second.reusableOperationId).toBe(newRun.testRunId);
    expect(second.supersededOperationIds).toEqual([]);
    expect(second.mutationCount).toBe(0);
  });

  it("does not reuse an authorization that has started publication", () => {
    const database = fixture();
    const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10V unsafe account" });
    const run = database.repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    insertAuthorization(database, { accountId: account.id, operationId: run.testRunId, createdAt: "2026-09-01T07:28:28.266Z", publicationTransactionCount: 1, finalSubmitAttemptCount: 1, state: "CONSUMED" });

    const result = database.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    expect(result.reusableOperationId).toBeNull();
    expect(result.activeUnusedAuthorizationCount).toBe(0);
    expect(result.mutationCount).toBe(0);
  });
});
