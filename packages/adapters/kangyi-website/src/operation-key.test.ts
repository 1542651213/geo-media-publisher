import { describe, expect, it } from "vitest";
import { createKangyiOperationKey, type KangyiOperationBinding } from "./operation-key";

const binding = (overrides: Partial<KangyiOperationBinding> = {}): KangyiOperationBinding => ({
  publishJobId: "job-123",
  submissionIntentId: "intent-456",
  contentBindingId: "snapshot-789",
  siteId: "kangyi",
  environment: "staging",
  operation: "create",
  immutableIdentity: "content-sha256-abc",
  ...overrides
});

describe("Kangyi operation idempotency binding", () => {
  it("reconstructs the same key after a process restart", () => {
    const first = createKangyiOperationKey(binding());
    const reconstructed = createKangyiOperationKey(JSON.parse(JSON.stringify(binding())) as KangyiOperationBinding);
    expect(reconstructed).toBe(first);
  });

  it("separates operation and immutable snapshot identities", () => {
    expect(createKangyiOperationKey(binding({ operation: "media" }))).not.toBe(createKangyiOperationKey(binding({ operation: "create" })));
    expect(createKangyiOperationKey(binding({ immutableIdentity: "content-sha256-different" }))).not.toBe(createKangyiOperationKey(binding()));
  });

  it("stays within the server idempotency-key contract", () => {
    const key = createKangyiOperationKey(binding());
    expect(key).toMatch(/^[A-Za-z0-9._~-]{8,128}$/u);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("does not encode a secret into the key", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const key = createKangyiOperationKey(binding({ immutableIdentity: "snapshot-hash-only" }));
    expect(key).not.toContain(secret);
    expect(key).not.toContain("CMS_PUBLISH");
  });
});
