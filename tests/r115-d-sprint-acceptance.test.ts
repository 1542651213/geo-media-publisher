import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readSprintAcceptance, sprintSelectionMatches, SPRINT_ACCEPTANCE_MARKER, SprintAcceptanceController } from "../apps/desktop/src/main/sprint-acceptance";

const directories: string[] = [];
const grant = { platformKey: "toutiao" as const, accountId: "account", articleId: "article", imageAssetId: "image",
  expectedRemoteId: "123456", contentHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
const binding = { platformKey: "toutiao", accountId: "account", articleId: "article", imageAssetId: "image", expectedRemoteId: "123456", contentHash: "a".repeat(64) };
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("R1.15-D package-owned exact one-shot selection", () => {
  it("admits only the exact current account/content/image/identity binding", () => {
    expect(sprintSelectionMatches(grant, binding)).toBe(true);
    for (const key of ["platformKey", "accountId", "articleId", "imageAssetId", "expectedRemoteId", "contentHash"])
      expect(sprintSelectionMatches(grant, { ...binding, [key]: "other" })).toBe(false);
    expect(sprintSelectionMatches({ ...grant, expiresAt: new Date(Date.now() - 1).toISOString() }, binding)).toBe(false);
  });
  it("reads only a packaged bounded marker and rejects duplicate platform quotas", () => {
    const directory = mkdtempSync(join(tmpdir(), "gmp-r115d-")); directories.push(directory);
    const marker = { version: 1, purpose: "R1.15-D-ONE-SHOT", expiresAt: grant.expiresAt,
      selections: [{ ...grant, expiresAt: undefined }] };
    writeFileSync(join(directory, SPRINT_ACCEPTANCE_MARKER), JSON.stringify(marker));
    expect(readSprintAcceptance(true, directory)).toEqual([grant]);
    expect(readSprintAcceptance(false, directory)).toEqual([]);
    writeFileSync(join(directory, SPRINT_ACCEPTANCE_MARKER), JSON.stringify({ ...marker, selections: [...marker.selections, { ...marker.selections[0], articleId: "replacement" }] }));
    expect(readSprintAcceptance(true, directory)).toEqual([]);
    writeFileSync(join(directory, SPRINT_ACCEPTANCE_MARKER), JSON.stringify({ ...marker, selections: [{ ...marker.selections[0], platformKey: "douyin" }] }));
    expect(readSprintAcceptance(true, directory)).toEqual([]);
  });
  it("admits exact confirmed preparation and original final actions while excluding retry/automatic publish", () => {
    const job = { id: "original", platformKey: "toutiao", accountId: "account", articleId: "article", selectedImageAssetId: "image" };
    let finalSubmitCount = 0;
    const repository = { listAccounts: () => [{ id: "account", platformKey: "toutiao", platformAccountId: "platform-account", externalAccountId: "123456" }],
      getArticle: () => ({ contentHash: "a".repeat(64) }), getJob: () => job, listJobs: () => [job], getSubmissionIntentByJob: () => ({ finalSubmitCount }) };
    const controller = new SprintAcceptanceController([grant], repository);
    const payload = { platformKey: "toutiao", articleId: "article", platformAccountId: "platform-account", selectedImageAssetId: "image", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" };
    expect(controller.allowsRequest("articles:prepare-publish", payload)).toBe(true);
    expect(controller.allowsRequest("articles:prepare-publish", { ...payload, finalPublishMode: "AUTO_PUBLISH" })).toBe(false);
    expect(controller.allowsRequest("articles:prepare-publish", { ...payload, selectedImageAssetId: "other" })).toBe(false);
    expect(controller.originalJob("toutiao", "article", "account")?.id).toBe("original");
    expect(controller.allowsRequest("jobs:confirm", { id: "original", dryRun: false })).toBe(true);
    expect(controller.allowsRequest("jobs:retry", { id: "original" })).toBe(false);
    expect(() => controller.assertFinalJob(job)).not.toThrow();
    finalSubmitCount = 1;
    expect(controller.allowsRequest("jobs:run", { id: "original" })).toBe(false);
    expect(() => controller.assertFinalJob(job)).toThrow();
    expect(controller.originalJob("toutiao", "article", "account")?.id).toBe("original");
  });
});
