import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type OneShotPublicationAuthorization, type PlatformSelfTestRun } from "@publisher/domain";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(): { database: ReturnType<typeof openDatabase>; authorization: OneShotPublicationAuthorization; run: PlatformSelfTestRun } {
  const directory = mkdtempSync(join(tmpdir(), "task10s-auth-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S 测试账号" });
  const run = database.repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L5_PUBLISH" });
  const authorization: OneShotPublicationAuthorization = {
    authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
    state: "AUTHORIZED_UNUSED",
    platformKey: "xiaohongshu",
    accountId: account.id as OneShotPublicationAuthorization["accountId"],
    operationId: run.testRunId,
    mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
    publicationTransactionCount: 0,
    publicationCommitActionCount: 0,
    finalSubmitAttemptCount: 0,
    finalSubmitRetryCount: 0,
    finalSubmitActionStarted: false,
    finalSubmitActionCompleted: false,
    consumedAt: null
  };
  return { database, authorization, run };
}

describe("Task10S authorization persistence", () => {
  it("commits confirmation and authorization together and returns an idempotent result", () => {
    const { database, authorization, run } = fixture();
    const first = database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization);
    const second = database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization);

    expect(first).toMatchObject({ created: true, authorization: { operationId: run.testRunId, state: "AUTHORIZED_UNUSED" } });
    expect(second).toMatchObject({ created: false, authorization: { operationId: run.testRunId, state: "AUTHORIZED_UNUSED" } });
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.publishConfirmedAt).not.toBeNull();
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations WHERE operation_id=?").get(run.testRunId)).toMatchObject({ count: 1 });
    expect(database.db.prepare("SELECT created_at,updated_at FROM one_shot_publication_authorizations WHERE operation_id=?").get(run.testRunId)).toMatchObject({ created_at: expect.any(String), updated_at: expect.any(String) });
    expect(() => database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, { ...authorization, accountId: "different-account" as OneShotPublicationAuthorization["accountId"] })).toThrow("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations WHERE operation_id=?").get(run.testRunId)).toMatchObject({ count: 1 });
  });

  it("rolls back publish confirmation when the authorization table is missing", () => {
    const { database, authorization, run } = fixture();
    database.db.exec("DROP TABLE one_shot_publication_authorizations");

    expect(() => database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization)).toThrow(/no such table/iu);
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.publishConfirmedAt).toBeNull();
  });

  it("rolls back publish confirmation when authorization insertion fails after the update", () => {
    const { database, authorization, run } = fixture();
    database.db.exec("CREATE TRIGGER task10t_fail_authorization_insert BEFORE INSERT ON one_shot_publication_authorizations BEGIN SELECT RAISE(ABORT, 'forced authorization insert failure'); END;");

    expect(() => database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization)).toThrow("forced authorization insert failure");
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.publishConfirmedAt).toBeNull();
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations").get()).toMatchObject({ count: 0 });
  });

  it("rejects an operation identity that is not bound to the confirmation run", () => {
    const { database, authorization, run } = fixture();

    expect(() => database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, { ...authorization, operationId: "different-operation" })).toThrow("ONE_SHOT_OPERATION_BINDING_MISMATCH");
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.publishConfirmedAt).toBeNull();
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations").get()).toMatchObject({ count: 0 });
  });

  it("persists an unused authorization and atomically consumes it only once", () => {
    const { database, authorization } = fixture();
    const created = database.repository.createOneShotPublicationAuthorization(authorization);
    expect(created).toMatchObject({ operationId: authorization.operationId, state: "AUTHORIZED_UNUSED" });
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "AUTHORIZED_UNUSED" });
    expect(database.repository.consumeOneShotPublicationAuthorization(authorization.operationId, authorization.accountId, authorization.platformKey)).toBe(true);
    expect(database.repository.consumeOneShotPublicationAuthorization(authorization.operationId, authorization.accountId, authorization.platformKey)).toBe(false);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "CONSUMED", finalSubmitAttemptCount: 1, publicationTransactionCount: 1, publicationCommitActionCount: 1, finalSubmitRetryCount: 0, finalSubmitActionStarted: true });
  });

  it("atomically locks authorization and submission intent at the final mouse boundary", () => {
    const { database, authorization, run } = fixture();
    database.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization);
    const job = database.repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: "自动化发布测试｜请忽略", body: "这是一条测试正文。", dryRun: false });
    const intent = database.repository.prepareSubmissionIntent(job.id);

    expect(database.repository.startOneShotFinalMousePress(authorization.operationId, authorization.accountId, authorization.platformKey, intent.id)).toBe(true);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "FINAL_MOUSEPRESS_DISPATCH_STARTED", finalSubmitAttemptCount: 1, publicationTransactionCount: 1, publicationCommitActionCount: 1, finalSubmitActionStarted: true });
    expect(database.repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Submitting", finalSubmitCount: 1 });
    expect(database.repository.startOneShotFinalMousePress(authorization.operationId, authorization.accountId, authorization.platformKey, intent.id)).toBe(false);
  });

  it("rolls back the authorization lock when the intent cannot be claimed", () => {
    const { database, authorization } = fixture();
    database.repository.createOneShotPublicationAuthorization(authorization);
    expect(database.repository.startOneShotFinalMousePress(authorization.operationId, authorization.accountId, authorization.platformKey, "missing-intent")).toBe(false);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)).toMatchObject({ state: "AUTHORIZED_UNUSED", finalSubmitAttemptCount: 0, publicationTransactionCount: 0 });
  });
});
