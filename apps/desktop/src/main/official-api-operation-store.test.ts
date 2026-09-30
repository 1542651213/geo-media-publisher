import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { OfficialApiOperation } from "../../../../packages/adapters/official-api/src/runtime";
import { SqliteOfficialApiOperationStore } from "./official-api-operation-store";

const directories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>["db"]> = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "official-api-store-")); directories.push(directory);
  const opened = openDatabase(join(directory, "fixture.db"), join(process.cwd(), "packages", "db", "migrations"));
  databases.push(opened.db);
  const timestamp = new Date(0).toISOString();
  opened.db.prepare("INSERT INTO platforms (id,platform_key,display_name,category,adapter_status,adapter_version,enabled,capabilities_json) VALUES ('platform','website','Website','Website','ready','1',1,'{}')").run();
  opened.db.prepare("INSERT INTO accounts (id,platform_key,name,login_status,enabled,created_at,updated_at) VALUES ('account-one','website','Website','logged_in',1,?,?)").run(timestamp, timestamp);
  opened.db.prepare("INSERT INTO brands (id,name,created_at,updated_at) VALUES ('brand-one','Brand',?,?)").run(timestamp, timestamp);
  opened.db.prepare("INSERT INTO articles (id,brand_id,title,body,ai_provider,ai_model,generated_at,content_hash,created_at,updated_at) VALUES ('article-one','brand-one','Article','Body','system','fixture',?,'hash-one',?,?)").run(timestamp, timestamp, timestamp);
  opened.db.prepare("INSERT INTO articles (id,brand_id,title,body,ai_provider,ai_model,generated_at,content_hash,created_at,updated_at) VALUES ('article-two','brand-one','Article 2','Body','system','fixture',?,'hash-two',?,?)").run(timestamp, timestamp, timestamp);
  for (const [jobId, articleId] of [["job-one", "article-one"], ["job-two", "article-one"], ["job-three", "article-two"]])
    opened.db.prepare("INSERT INTO publish_jobs (id,account_id,platform_key,article_id,scheduled_at,created_at) VALUES (?, 'account-one','website',?,?,?)").run(jobId, articleId, timestamp, timestamp);
  return { ...opened, store: new SqliteOfficialApiOperationStore(opened.repository) };
}

function operation(jobId = "job-one", articleId = "article-one"): OfficialApiOperation {
  const timestamp = new Date(0).toISOString();
  return { version: 1, revision: 0, jobId, accountId: "account-one", articleId, siteId: "kangyi", environment: "staging",
    keyId: "staging-editor", sourceHash: "a".repeat(64), contentBindingId: "b".repeat(64), externalId: `geo-${articleId}`,
    phase: "PREPARING", prepared: { version: 1, source: { articleId, brandId: "brand-one", title: "Title", body: "Body", summary: "Summary",
      tags: ["tag"], seoKeywords: ["key"], articleType: "article", city: "Nanjing" }, scope: { accountId: "account-one", siteId: "kangyi",
      environment: "staging", keyId: "staging-editor" }, settings: { version: 1, kind: "article", coverAssetId: null,
      bodyImageAssetIds: [], galleryAssetIds: [] }, slug: "geo-article", sourceHash: "a".repeat(64), contentBindingId: "b".repeat(64),
      images: [], draftPreview: { kind: "article", slug: "geo-article", title: "Title", blocks: [{ type: "paragraph", text: "Body" }] } },
    media: [], maintenance: [], createdAt: timestamp, updatedAt: timestamp };
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SqliteOfficialApiOperationStore", () => {
  it("persists the whole journal and indexed remote identities across reopen", () => {
    const { db, store } = setup(); const inserted = store.insert(operation());
    const next: OfficialApiOperation = { ...inserted, phase: "PUBLISH_ACCEPTED", create: { state: "SUCCEEDED", idempotencyKey: "official_key_create",
      exactJson: "{\"draft\":{}}", bodySha256: "c".repeat(64), response: { contentId: "content-one", revisionId: "revision-one", contentHash: "d".repeat(64), rowVersion: 1 } },
      remoteContent: { contentId: "content-one", revisionId: "revision-one", contentHash: "d".repeat(64), rowVersion: 1 },
      remoteJob: { jobId: "cms-job-one", status: "queued", publicUrl: null }, updatedAt: new Date(1).toISOString() };
    store.compareAndSwap("job-one", 0, next); db.close();
    const reopened = openDatabase(join(directories[0]!, "fixture.db"), join(process.cwd(), "packages", "db", "migrations"));
    databases.push(reopened.db);
    const recovered = new SqliteOfficialApiOperationStore(reopened.repository).getByJobId("job-one");
    expect(recovered).toMatchObject({ revision: 1, phase: "PUBLISH_ACCEPTED", remoteContent: { contentId: "content-one" },
      remoteJob: { jobId: "cms-job-one" }, create: { exactJson: "{\"draft\":{}}", idempotencyKey: "official_key_create" } });
    const indexed = reopened.db.prepare("SELECT remote_content_id,remote_job_id FROM official_api_operations WHERE job_id='job-one'").get();
    expect(indexed).toEqual({ remote_content_id: "content-one", remote_job_id: "cms-job-one" }); reopened.db.close();
  });

  it("enforces one durable journal for the same account and source article even after failure", () => {
    const { db, store } = setup(); const first = store.insert(operation());
    store.compareAndSwap("job-one", 0, { ...first, phase: "FAILED", errorCode: "REMOTE_REJECTED" });
    expect(() => store.insert(operation("job-two", "article-one"))).toThrow("OFFICIAL_API_SOURCE_ALREADY_BOUND"); db.close();
  });

  it("rejects stale whole-journal updates and supports account/source lookup", () => {
    const { db, store } = setup(); const first = store.insert(operation());
    const updated = store.compareAndSwap("job-one", 0, { ...first, phase: "PREPARED" });
    expect(store.findBySource("account-one", "article-one")).toEqual(updated);
    expect(() => store.compareAndSwap("job-one", 0, { ...first, phase: "FAILED" })).toThrow("OFFICIAL_API_OPERATION_CONCURRENT_UPDATE"); db.close();
  });
});
