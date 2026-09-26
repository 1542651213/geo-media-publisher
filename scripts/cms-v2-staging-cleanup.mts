import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CmsV2Client } from "@publisher/cms-v2-client";

const siteId = process.env.GEO_PILOT_SITE_ID;
const origin = process.env.GEO_PILOT_ORIGIN;
const keyId = process.env.GEO_PILOT_KEY_ID;
const secretFile = process.env.GEO_PILOT_SECRET_FILE;
const contentId = process.env.GEO_PILOT_CONTENT_ID;
const publicUrl = process.env.GEO_PILOT_PUBLIC_URL;
const externalId = process.env.GEO_PILOT_EXTERNAL_ID;
if (!siteId || !["huiquan", "shupai"].includes(siteId) || !origin?.startsWith("https://") || !keyId || !secretFile || !contentId || !externalId) throw new Error("GEO staging cleanup configuration incomplete");
const client = new CmsV2Client({ origin, siteId, environment: "staging", keyId, secret: readFileSync(secretFile, "utf8").trim(), maxRetries: 0 });
const poll = async (jobId: string) => { const job = await client.waitForJob(jobId, { maxPolls: 90, intervalMs: 1000 }); if (job.data.status !== "succeeded") throw new Error(`Cleanup job ${jobId} ended ${job.data.status}`); };
let current = (await client.getContent(contentId)).data;
if (current.siteId !== siteId || current.environment !== "staging" || current.externalId !== externalId) throw new Error("GEO_CLEANUP_SCOPE_MISMATCH");
if (current.publishedRevisionId) {
  const result = await client.unpublish(contentId, { rowVersion: current.rowVersion, expectedPublishedRevisionId: current.publishedRevisionId }, `geo_${randomUUID()}`);
  if (result.httpStatus !== 202) throw new Error("GEO_CLEANUP_UNPUBLISH_NOT_QUEUED");
  await poll(result.data.jobId);
  current = (await client.getContent(contentId)).data;
}
if (!current.deletedAt) {
  const result = await client.deleteContent(contentId, { rowVersion: current.rowVersion, expectedPublishedRevisionId: current.publishedRevisionId, reason: "GEO staging 系统验收结束后清理临时内容" }, `geo_${randomUUID()}`);
  if (result.httpStatus !== 202) throw new Error("GEO_CLEANUP_DELETE_NOT_QUEUED");
  await poll(result.data.jobId);
}
const active = await client.listContents({ kind: "article", status: "active", externalId });
if (active.data.total !== 0) throw new Error("GEO_CLEANUP_ACTIVE_RESIDUE");
if (publicUrl && (await fetch(publicUrl)).status !== 404) throw new Error("GEO_CLEANUP_PUBLIC_RESIDUE");
process.stdout.write(JSON.stringify({ siteId, contentId, cleanup: "PASS", activeCount: active.data.total, publicStatus: publicUrl ? 404 : null }) + "\n");
