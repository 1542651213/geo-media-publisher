import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { CmsV2Client } from "../packages/cms-v2-client/src/client";
import { recoverAppliedPublishResponse } from "../packages/cms-v2-client/src/publish-recovery";

interface TestPool { execute(sql: string, parameters: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> }
interface ServerFactory { createCmsHttpServer(options: Record<string, unknown>): { server: Server;
  publication: { processOne(verifier: { verify(): Promise<{ ok: boolean; status: number; evidence: Record<string, unknown> }> }): Promise<unknown> } } }
interface DatabaseFactory { createCmsPool(config: Record<string, unknown>): TestPool }

const baseline = process.env.KANGYI_PROOF_DEPLOYED_CMS_DIR;
assert.ok(baseline && isAbsolute(baseline), "explicit verified deployed CMS copy required");
const expected = { "http-v2.js": "aff006db1a0c2771a1c607f8cc68032df265e0cd8eb93b216a0d40046a94ff1b",
  "publication.js": "66871d63f064356b65ca2103dbd892808611d027956733762a900b5f027830f5",
  "idempotency-v2.js": "b210d3265fa5a4a14381895963eba813bbaa0031ac3ee70993114bfd10473870" };
for (const [name, hash] of Object.entries(expected)) assert.equal(createHash("sha256").update(await readFile(join(baseline, name))).digest("hex"), hash);
const config = JSON.parse(await readFile(process.env.CMS_TEST_MYSQL_CONFIG ?? "D:/kangyi-k3-local-mysql/cms-test.json", "utf8")) as Record<string, unknown>;
assert.deepEqual([config.host, config.port, config.database], ["127.0.0.1", 23306, "cms_k3_local"], "isolated loopback test DB only");
if (!config.password) {
  const defaults = await readFile(process.env.CMS_LOCAL_ROOT_DEFAULTS_FILE ?? "D:/kangyi-k3-local-mysql/root-client.cnf", "utf8");
  const field = (name: string) => new RegExp(`^${name}\\s*=\\s*(.+)$`, "mu").exec(defaults)?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
  config.user = field("user"); config.password = field("password");
  assert.ok(config.user && config.password, "local test authentication required");
}
const databaseModule: unknown = await import(pathToFileURL(join(baseline, "database.js")).href);
const httpModule: unknown = await import(pathToFileURL(join(baseline, "http-v2.js")).href);
const pool = (databaseModule as DatabaseFactory).createCmsPool(config);
const siteId = `geo-proof-${randomUUID()}`;
const environment = "local" as const;
const principalId = "geo-proof-editor";
const keyId = "geo-proof-fixture-key";
const secret = randomBytes(32).toString("hex");
const temporaryMedia = await mkdtemp(join(tmpdir(), "geo-r115c-contract-proof-"));
const { server, publication } = (httpModule as ServerFactory).createCmsHttpServer({ pool,
  scope: { siteId, environment }, origin: "https://example.test", mediaRoot: temporaryMedia,
  readToken: randomBytes(32).toString("hex"), writeEnabled: true,
  keys: [{ keyId, principalId, siteId, environment, secret, permissions: ["read", "write"] }] });
const realFetch = globalThis.fetch;
let phase = "START";
const countJobs = async (): Promise<number> => {
  const [rows] = await pool.execute("SELECT COUNT(*) AS n FROM publish_jobs WHERE site_id=? AND environment=?", [siteId, environment]);
  assert.ok(Array.isArray(rows)); return Number((rows[0] as { n: number }).n);
};
try {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const client = new CmsV2Client({ origin: `http://127.0.0.1:${address.port}`, siteId, environment, keyId, secret });
  const externalId = `geo-proof:${randomUUID()}`;
  const created = (await client.createContent({ externalId, draft: { kind: "article", slug: `geo-proof-${randomUUID()}`,
    title: "隔离协议安全验证", summary: "仅在本地隔离数据库运行的原始响应恢复验证。", category: "测试",
    seoTitle: "隔离协议安全验证", seoDescription: "本地测试，非业务文章。", keywords: ["协议验证"], takeaways: ["一个远端任务"],
    showOnHomepage: false, blocks: [{ type: "paragraph", text: "缓存存在与过期均不得创建第二个远端任务。" }] } }, `create-${randomUUID()}`)).data;
  const idempotencyKey = `publish-${randomUUID()}`;
  const binding = { siteId, environment, principalId, externalId, contentId: created.contentId, kind: "article" as const,
    revisionId: created.revisionId, contentHash: created.contentHash, rowVersion: created.rowVersion, idempotencyKey,
    exactJson: JSON.stringify({ revisionId: created.revisionId, contentHash: created.contentHash, rowVersion: created.rowVersion }) };
  let publishHttpRequests = 0;
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    if (init?.method === "POST" && String(input).endsWith(`/contents/${created.contentId}/publish`)) {
      publishHttpRequests += 1;
      if (publishHttpRequests === 1) { await response.arrayBuffer(); throw new Error("LOCAL_FIXTURE_REPLY_LOST"); }
    }
    return response;
  };
  phase = "INITIAL_RESPONSE_LOSS";
  await assert.rejects(client.request("POST", `/contents/${created.contentId}/publish`,
    { exactJson: binding.exactJson, idempotencyKey }), { code: "TRANSPORT_UNCERTAIN", outcomeUnknown: true });
  assert.equal(await countJobs(), 1);
  phase = "QUEUED_FENCE";
  await assert.rejects(recoverAppliedPublishResponse(client, binding), { code: "REMOTE_STATUS_UNKNOWN" });
  assert.equal(publishHttpRequests, 1, "pending unproven effect must not send a cache request");
  await publication.processOne({ verify: async () => ({ ok: true, status: 200, evidence: { isolatedFixture: true } }) });
  phase = "APPLIED_CACHED_RESPONSE";
  const recovered = await recoverAppliedPublishResponse(client, binding);
  assert.equal(recovered.httpStatus, 202);
  assert.equal((await client.getJob(recovered.data.jobId)).data.status, "succeeded");
  assert.equal(await countJobs(), 1);
  const originalJobId = recovered.data.jobId;
  phase = "CACHE_EXPIRY_FENCE";
  await pool.execute("DELETE FROM idempotency_records WHERE site_id=? AND environment=? AND principal_id=? AND method='POST' AND request_target=? AND idempotency_key=?",
    [siteId, environment, principalId, `/_publish-api/v2/contents/${created.contentId}/publish`, idempotencyKey]);
  await assert.rejects(recoverAppliedPublishResponse(client, binding), { code: "REMOTE_STATUS_UNKNOWN" });
  assert.equal(await countJobs(), 1, "actual deployed enqueue guard must prevent a replacement even after cache deletion");
  assert.equal((await client.getJob(originalJobId)).data.status, "succeeded");
  const report = { status: "PASS", deployedSourceHashes: expected, isolatedDatabase: "127.0.0.1:23306/cms_k3_local",
    publishResponseLost: true, pendingRecoveryPostCount: 0, originalJobRecovered: true,
    cachedResponseReads: 1, expiryProbeRejected: true, remoteLogicalPublishCount: 1, duplicateContentCount: 0,
    cmsSourceChanged: false, productionAccess: false, secretsPrinted: false };
  const reportPath = resolve("output/r115-c-execution-20260930/server-contract-proof.json");
  await mkdir(resolve("output/r115-c-execution-20260930"), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + "\n");
} catch {
  process.stderr.write(`SERVER_CONTRACT_PROOF_FAILED:${phase}\n`); process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  assert.match(siteId, /^geo-proof-[0-9a-f-]{36}$/u);
  // Every row was created in this random local-only scope; no existing business scope is admissible.
  for (const table of ["audit_events", "publish_jobs", "idempotency_records", "content_identity_reservations", "content_revisions", "content_items", "request_nonces", "auth_rate_windows"])
    await pool.execute(`DELETE FROM ${table} WHERE site_id=? AND environment=?`, [siteId, environment]);
  await pool.end();
  const relation = relative(resolve(tmpdir()), resolve(temporaryMedia));
  assert.ok(relation && !relation.startsWith("..") && !isAbsolute(relation));
  await rm(temporaryMedia, { recursive: true, force: true });
}
