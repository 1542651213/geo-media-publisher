import { describe, expect, it } from "vitest";
import { assertKangyiExactJsonBody, kangyiSha256Utf8, parseKangyiOperationMetadata, serializeKangyiOperationMetadata } from "./kangyi-operation";

const base = {
  version: 1 as const,
  siteId: "kangyi",
  environment: "staging" as const,
  accountId: "account-1",
  jobId: "job-1",
  intentId: "intent-1",
  contentBindingId: "binding-1",
  snapshotId: "binding-1",
  phase: "CREATE" as const,
  lastErrorCode: null,
  media: [],
  create: { idempotencyKey: "kangyi_v2_create_1", exactRequestBody: '{"draft":{"title":"A"}}', requestBodySha256: kangyiSha256Utf8('{"draft":{"title":"A"}}'), state: "PREPARED" as const },
  draft: null,
  validate: null,
  publish: null,
  poll: null,
  publishRecordId: null
};

describe("Kangyi durable operation metadata", () => {
  it("uses the protocol SHA-256 digest for UTF-8 request bodies", () => {
    expect(kangyiSha256Utf8("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("round-trips exact JSON bodies and rejects a changed body", () => {
    const parsed = parseKangyiOperationMetadata(serializeKangyiOperationMetadata(base));
    expect(parsed?.create?.exactRequestBody).toBe('{"draft":{"title":"A"}}');
    expect(() => assertKangyiExactJsonBody('{"draft":{"title":"B"}}', base.create.requestBodySha256)).toThrow("KANGYI_EXACT_BODY_HASH_MISMATCH");
  });

  it("does not accept an invalid idempotency key or malformed persisted metadata", () => {
    expect(() => parseKangyiOperationMetadata(JSON.stringify({ ...base, create: { ...base.create, idempotencyKey: "bad key" } }))).toThrow("KANGYI_INVALID_IDEMPOTENCY_KEY");
    expect(() => parseKangyiOperationMetadata(JSON.stringify({ ...base, create: { ...base.create, exactRequestBody: "not-json" } }))).toThrow("KANGYI_EXACT_BODY_HASH_MISMATCH");
  });
});
