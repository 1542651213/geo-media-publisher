import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type OneShotPublicationAuthorization } from "@publisher/domain";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(): { database: ReturnType<typeof openDatabase>; authorization: OneShotPublicationAuthorization } {
  const directory = mkdtempSync(join(tmpdir(), "task10s-auth-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S 测试账号" });
  const authorization: OneShotPublicationAuthorization = {
    authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
    state: "AUTHORIZED_UNUSED",
    platformKey: "xiaohongshu",
    accountId: account.id as OneShotPublicationAuthorization["accountId"],
    operationId: "task10s-operation-1",
    mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
    publicationTransactionCount: 0,
    publicationCommitActionCount: 0,
    finalSubmitAttemptCount: 0,
    finalSubmitRetryCount: 0,
    finalSubmitActionStarted: false,
    finalSubmitActionCompleted: false,
    consumedAt: null
  };
  return { database, authorization };
}

describe("Task10S authorization persistence", () => {
  it("persists an unused authorization and atomically consumes it only once", () => {
    const { database, authorization } = fixture();
    const created = database.repository.createOneShotPublicationAuthorization(authorization);
    expect(created).toMatchObject({ operationId: authorization.operationId, state: "AUTHORIZED_UNUSED" });
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "AUTHORIZED_UNUSED" });
    expect(database.repository.consumeOneShotPublicationAuthorization(authorization.operationId, authorization.accountId, authorization.platformKey)).toBe(true);
    expect(database.repository.consumeOneShotPublicationAuthorization(authorization.operationId, authorization.accountId, authorization.platformKey)).toBe(false);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "CONSUMED", finalSubmitAttemptCount: 1, publicationTransactionCount: 1, publicationCommitActionCount: 1, finalSubmitRetryCount: 0, finalSubmitActionStarted: true });
  });
});
