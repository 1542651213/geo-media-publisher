import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { B01_CANDIDATE_MARKER, b01CandidateCapabilityEnabled } from "../apps/desktop/src/main/b01-candidate-capability";

describe("B01 package capability", () => {
  it("requires an exact marker in a packaged Candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "gmp-b01-marker-"));
    try {
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(false);
      writeFileSync(join(root, B01_CANDIDATE_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "R2" }));
      expect(b01CandidateCapabilityEnabled(false, root)).toBe(false);
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(true);
      writeFileSync(join(root, B01_CANDIDATE_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "R1" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
