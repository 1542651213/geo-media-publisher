import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { PublisherService } from "@publisher/publisher";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "task10s-self-test-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(platformCsv);
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S 指定账号" });
  database.repository.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, account.id);
  const publisher = new PublisherService(database.repository, new AdapterRegistry(), logger, { resolveSecrets: () => ({}) });
  const service = new PlatformSelfTestService({ repository: database.repository, registry: new AdapterRegistry(), publisher, resolveAccountSecrets: () => ({}), logger });
  return { database, service };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Task10S platform self-test entry", () => {
  it("does not create authorization or a publish job before owner confirmation", () => {
    const { database, service } = fixture();
    const requested = service.requestOneShotPublish(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID);
    expect(requested.overallResult).toBe("WAITING_FOR_USER");
    expect(requested.steps.find((item) => item.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")?.message).toBe("本次会真实发布 1 条测试笔记，最多提交一次。");
    expect(database.repository.listJobs()).toHaveLength(0);
    expect(database.repository.getOneShotPublicationAuthorization(requested.testRunId)).toBeNull();
  });

  it("cancels without granting authorization", () => {
    const { database, service } = fixture();
    const requested = service.requestOneShotPublish(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID);
    const cancelled = service.cancelOneShotPublish(requested.testRunId);
    expect(cancelled.overallResult).toBe("NOT_TESTED");
    expect(cancelled.steps.at(-1)?.errorCode).toBe("ONE_SHOT_PUBLISH_CANCELLED");
    expect(database.repository.listJobs()).toHaveLength(0);
  });
});
