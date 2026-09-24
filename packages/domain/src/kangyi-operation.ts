export type KangyiOperationName = "media" | "create" | "draft" | "validate" | "publish";
export type KangyiOperationPhase = "PREPARING" | "MEDIA" | "CREATE" | "DRAFT" | "VALIDATE" | "PUBLISH" | "POLL" | "COMPLETE" | "FAILED" | "NEEDS_RECONCILIATION";
export type KangyiOperationState = "PREPARED" | "IN_FLIGHT" | "SUCCEEDED" | "OUTCOME_UNKNOWN" | "FAILED";

export interface KangyiMediaOperationMetadata {
  assetId: string;
  snapshotSha256: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  idempotencyKey: string;
  mediaId: string | null;
  serverSha256: string | null;
  width: number | null;
  height: number | null;
  state: KangyiOperationState;
}

export interface KangyiJsonOperationMetadata {
  idempotencyKey: string;
  exactRequestBody: string;
  requestBodySha256: string;
  state: KangyiOperationState;
  responseIdentity?: Record<string, string | number | boolean | null>;
}

export interface KangyiPublishOperationMetadata extends KangyiJsonOperationMetadata {
  cmsJobId: string | null;
}

export interface KangyiPollMetadata {
  cmsJobId: string;
  lastKnownStatus: "queued" | "processing" | "verifying" | "succeeded" | "failed" | "needs_attention";
  lastPolledAt: string | null;
  publicUrl: string | null;
  verification: Record<string, unknown> | null;
  terminalState: "NON_TERMINAL" | "SUCCEEDED" | "FAILED" | "NEEDS_RECONCILIATION";
}

export interface KangyiWebsiteOperationMetadataV1 {
  version: 1;
  /** One owner authorization can reserve exactly one staging intent for the first-article pilot. */
  pilotAuthorizationId?: string;
  siteId: string;
  environment: "local" | "staging" | "production";
  accountId: string;
  jobId: string;
  intentId: string;
  contentBindingId: string;
  snapshotId: string;
  phase: KangyiOperationPhase;
  lastErrorCode: string | null;
  media: KangyiMediaOperationMetadata[];
  create: KangyiJsonOperationMetadata | null;
  draft: KangyiJsonOperationMetadata | null;
  validate: KangyiJsonOperationMetadata | null;
  publish: KangyiPublishOperationMetadata | null;
  poll: KangyiPollMetadata | null;
  publishRecordId: string | null;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

function sha256Bytes(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const highLength = Math.floor(bitLength / 0x100000000);
  const lowLength = bitLength >>> 0;
  padded[padded.length - 8] = highLength >>> 24;
  padded[padded.length - 7] = highLength >>> 16;
  padded[padded.length - 6] = highLength >>> 8;
  padded[padded.length - 5] = highLength;
  padded[padded.length - 4] = lowLength >>> 24;
  padded[padded.length - 3] = lowLength >>> 16;
  padded[padded.length - 2] = lowLength >>> 8;
  padded[padded.length - 1] = lowLength;

  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      schedule[index] = (padded[position]! << 24) | (padded[position + 1]! << 16) | (padded[position + 2]! << 8) | padded[position + 3]!;
    }
    for (let index = 16; index < 64; index += 1) {
      const value1 = schedule[index - 15]!;
      const value2 = schedule[index - 2]!;
      const smallSigma0 = rotr(value1, 7) ^ rotr(value1, 18) ^ (value1 >>> 3);
      const smallSigma1 = rotr(value2, 17) ^ rotr(value2, 19) ^ (value2 >>> 10);
      schedule[index] = (schedule[index - 16]! + smallSigma0 + schedule[index - 7]! + smallSigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + bigSigma1 + choice + SHA256_K[index]! + schedule[index]!) >>> 0;
      const bigSigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  return Array.from(hash, (value) => value.toString(16).padStart(8, "0")).join("");
}

export function kangyiSha256Utf8(value: string): string {
  return sha256Bytes(new TextEncoder().encode(value));
}

export function assertKangyiIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9._~-]{8,128}$/u.test(value)) throw new Error("KANGYI_INVALID_IDEMPOTENCY_KEY");
}

export function assertKangyiExactJsonBody(body: string, expectedSha256: string): void {
  if (!body || kangyiSha256Utf8(body) !== expectedSha256) throw new Error("KANGYI_EXACT_BODY_HASH_MISMATCH");
  try { JSON.parse(body); } catch { throw new Error("KANGYI_EXACT_BODY_NOT_JSON"); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isState(value: unknown): value is KangyiOperationState {
  return value === "PREPARED" || value === "IN_FLIGHT" || value === "SUCCEEDED" || value === "OUTCOME_UNKNOWN" || value === "FAILED";
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function parseJsonOperation(value: unknown, code: string): KangyiJsonOperationMetadata {
  if (!isRecord(value)) throw new Error(code);
  const idempotencyKey = requireString(value.idempotencyKey, `${code}_KEY`);
  const exactRequestBody = requireString(value.exactRequestBody, `${code}_BODY`);
  const requestBodySha256 = requireString(value.requestBodySha256, `${code}_HASH`);
  if (!isState(value.state)) throw new Error(`${code}_STATE`);
  assertKangyiIdempotencyKey(idempotencyKey);
  assertKangyiExactJsonBody(exactRequestBody, requestBodySha256);
  const responseIdentity = value.responseIdentity === undefined ? undefined : isRecord(value.responseIdentity) ? value.responseIdentity as Record<string, string | number | boolean | null> : (() => { throw new Error(`${code}_RESPONSE`); })();
  return { idempotencyKey, exactRequestBody, requestBodySha256, state: value.state, ...(responseIdentity ? { responseIdentity } : {}) };
}

export function parseKangyiOperationMetadata(serialized: string | null | undefined): KangyiWebsiteOperationMetadataV1 | null {
  if (serialized == null) return null;
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("KANGYI_OPERATION_METADATA_INVALID_JSON"); }
  if (!isRecord(value) || value.version !== 1) throw new Error("KANGYI_OPERATION_METADATA_VERSION_UNSUPPORTED");
  const environment = value.environment;
  if (environment !== "local" && environment !== "staging" && environment !== "production") throw new Error("KANGYI_OPERATION_METADATA_ENVIRONMENT_INVALID");
  const phase = value.phase;
  if (!["PREPARING", "MEDIA", "CREATE", "DRAFT", "VALIDATE", "PUBLISH", "POLL", "COMPLETE", "FAILED", "NEEDS_RECONCILIATION"].includes(String(phase))) throw new Error("KANGYI_OPERATION_METADATA_PHASE_INVALID");
  if (!Array.isArray(value.media)) throw new Error("KANGYI_OPERATION_METADATA_MEDIA_INVALID");
  const media = value.media.map((item, index): KangyiMediaOperationMetadata => {
    if (!isRecord(item) || !["image/jpeg", "image/png", "image/webp"].includes(String(item.mime)) || !isState(item.state)) throw new Error(`KANGYI_OPERATION_METADATA_MEDIA_${index}_INVALID`);
    const idempotencyKey = requireString(item.idempotencyKey, `KANGYI_OPERATION_METADATA_MEDIA_${index}_KEY`);
    assertKangyiIdempotencyKey(idempotencyKey);
    return {
      assetId: requireString(item.assetId, `KANGYI_OPERATION_METADATA_MEDIA_${index}_ASSET`),
      snapshotSha256: requireString(item.snapshotSha256, `KANGYI_OPERATION_METADATA_MEDIA_${index}_HASH`),
      mime: item.mime as KangyiMediaOperationMetadata["mime"],
      bytes: typeof item.bytes === "number" && Number.isSafeInteger(item.bytes) && item.bytes > 0 ? item.bytes : (() => { throw new Error(`KANGYI_OPERATION_METADATA_MEDIA_${index}_BYTES`); })(),
      idempotencyKey,
      mediaId: item.mediaId === null ? null : requireString(item.mediaId, `KANGYI_OPERATION_METADATA_MEDIA_${index}_ID`),
      serverSha256: item.serverSha256 === null ? null : requireString(item.serverSha256, `KANGYI_OPERATION_METADATA_MEDIA_${index}_SERVER_HASH`),
      width: item.width === null ? null : typeof item.width === "number" ? item.width : (() => { throw new Error(`KANGYI_OPERATION_METADATA_MEDIA_${index}_WIDTH`); })(),
      height: item.height === null ? null : typeof item.height === "number" ? item.height : (() => { throw new Error(`KANGYI_OPERATION_METADATA_MEDIA_${index}_HEIGHT`); })(),
      state: item.state
    };
  });
  const create = value.create === null ? null : parseJsonOperation(value.create, "KANGYI_OPERATION_METADATA_CREATE");
  const draft = value.draft === null ? null : parseJsonOperation(value.draft, "KANGYI_OPERATION_METADATA_DRAFT");
  const validate = value.validate === null ? null : parseJsonOperation(value.validate, "KANGYI_OPERATION_METADATA_VALIDATE");
  let publish: KangyiPublishOperationMetadata | null = null;
  if (value.publish !== null) {
    const parsed = parseJsonOperation(value.publish, "KANGYI_OPERATION_METADATA_PUBLISH");
    if (!isRecord(value.publish) || (value.publish.cmsJobId !== null && typeof value.publish.cmsJobId !== "string")) throw new Error("KANGYI_OPERATION_METADATA_PUBLISH_JOB");
    publish = { ...parsed, cmsJobId: value.publish.cmsJobId as string | null };
  }
  let poll: KangyiPollMetadata | null = null;
  if (value.poll !== null) {
    if (!isRecord(value.poll) || typeof value.poll.cmsJobId !== "string" || !["queued", "processing", "verifying", "succeeded", "failed", "needs_attention"].includes(String(value.poll.lastKnownStatus)) || !["NON_TERMINAL", "SUCCEEDED", "FAILED", "NEEDS_RECONCILIATION"].includes(String(value.poll.terminalState))) throw new Error("KANGYI_OPERATION_METADATA_POLL_INVALID");
    poll = { cmsJobId: value.poll.cmsJobId, lastKnownStatus: value.poll.lastKnownStatus as KangyiPollMetadata["lastKnownStatus"], lastPolledAt: value.poll.lastPolledAt === null ? null : requireString(value.poll.lastPolledAt, "KANGYI_OPERATION_METADATA_POLL_TIME"), publicUrl: value.poll.publicUrl === null ? null : requireString(value.poll.publicUrl, "KANGYI_OPERATION_METADATA_POLL_URL"), verification: value.poll.verification === null ? null : isRecord(value.poll.verification) ? value.poll.verification : (() => { throw new Error("KANGYI_OPERATION_METADATA_POLL_VERIFICATION"); })(), terminalState: value.poll.terminalState as KangyiPollMetadata["terminalState"] };
  }
  return {
    version: 1,
    ...(value.pilotAuthorizationId === undefined ? {} : { pilotAuthorizationId: requireString(value.pilotAuthorizationId, "KANGYI_OPERATION_METADATA_PILOT_AUTH") }),
    siteId: requireString(value.siteId, "KANGYI_OPERATION_METADATA_SITE"),
    environment,
    accountId: requireString(value.accountId, "KANGYI_OPERATION_METADATA_ACCOUNT"),
    jobId: requireString(value.jobId, "KANGYI_OPERATION_METADATA_JOB"),
    intentId: requireString(value.intentId, "KANGYI_OPERATION_METADATA_INTENT"),
    contentBindingId: requireString(value.contentBindingId, "KANGYI_OPERATION_METADATA_BINDING"),
    snapshotId: requireString(value.snapshotId, "KANGYI_OPERATION_METADATA_SNAPSHOT"),
    phase: phase as KangyiOperationPhase,
    lastErrorCode: value.lastErrorCode === null ? null : requireString(value.lastErrorCode, "KANGYI_OPERATION_METADATA_ERROR"),
    media,
    create,
    draft,
    validate,
    publish,
    poll,
    publishRecordId: value.publishRecordId === null ? null : requireString(value.publishRecordId, "KANGYI_OPERATION_METADATA_RECORD")
  };
}

export function serializeKangyiOperationMetadata(metadata: KangyiWebsiteOperationMetadataV1): string {
  const serialized = JSON.stringify(metadata);
  parseKangyiOperationMetadata(serialized);
  return serialized;
}
