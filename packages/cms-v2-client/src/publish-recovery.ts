import { ClientError, type CmsV2Client } from "./client";
import type { ContentKind, DeployEnvironment, Job, Publish } from "./contracts";

export interface AppliedPublishRecoveryBinding extends Publish {
  siteId: string;
  environment: DeployEnvironment;
  principalId: string;
  externalId: string;
  contentId: string;
  kind: ContentKind;
  exactJson: string;
  idempotencyKey: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const unknown = (): ClientError => new ClientError("REMOTE_STATUS_UNKNOWN", "原发布结果尚不能确认，请保留原任务继续核对", 0, undefined, undefined, undefined, true);

/**
 * Reads the original response, never authorizes a new publication.
 * The current CMS checks rowVersion before enqueuePublish. An applied, strictly
 * newer row permanently fences the retained old request, even if its cache has
 * expired between the GET and POST. The only possible 202 is the original cached
 * response. Pending/changed identities have no replay path here. Compensation
 * also advances the row; its original job is recovered then read as failed,
 * rather than mistaking the reverted public pointer for permission to republish.
 */
export async function recoverAppliedPublishResponse(
  client: Pick<CmsV2Client, "getContent" | "request">,
  binding: AppliedPublishRecoveryBinding
) {
  let payload: unknown;
  try { payload = JSON.parse(binding.exactJson); } catch { payload = null; }
  const fields = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (!fields || Object.keys(fields).sort().join(",") !== "contentHash,revisionId,rowVersion"
    || fields.revisionId !== binding.revisionId || fields.contentHash !== binding.contentHash || fields.rowVersion !== binding.rowVersion
    || !uuid.test(binding.contentId) || !uuid.test(binding.revisionId) || !/^[a-f0-9]{64}$/u.test(binding.contentHash)
    || !Number.isSafeInteger(binding.rowVersion) || binding.rowVersion < 1 || !binding.principalId || !binding.externalId
    || !/^[A-Za-z0-9._~-]{8,128}$/u.test(binding.idempotencyKey))
    throw new ClientError("RECOVERY_BINDING_MISMATCH", "恢复请求与持久化的原发布绑定不一致");

  const remote = (await client.getContent(binding.contentId)).data;
  if (remote.id !== binding.contentId || remote.contentId !== binding.contentId
    || remote.siteId !== binding.siteId || remote.environment !== binding.environment || remote.principalId !== binding.principalId
    || remote.externalId !== binding.externalId || remote.kind !== binding.kind || remote.deletedAt !== null
    || remote.revisionId !== binding.revisionId || remote.draftRevisionId !== binding.revisionId
    || remote.contentHash !== binding.contentHash
    || !Number.isSafeInteger(remote.rowVersion) || remote.rowVersion <= binding.rowVersion) throw unknown();

  let result;
  try {
    result = await client.request<Job>("POST", `/contents/${binding.contentId}/publish`,
      { exactJson: binding.exactJson, idempotencyKey: binding.idempotencyKey });
  } catch { throw unknown(); }
  const job = result.data;
  if (result.httpStatus !== 202 || !uuid.test(job.jobId) || job.operation !== "publish"
    || job.siteId !== binding.siteId || job.environment !== binding.environment || job.contentId !== binding.contentId
    || job.revisionId !== binding.revisionId || job.contentHash !== binding.contentHash) throw unknown();
  return result;
}
