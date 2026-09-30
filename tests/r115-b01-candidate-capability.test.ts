import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { B01_CANDIDATE_MARKER, B01_CANDIDATE_R3_MARKER, b01CandidateCapabilityEnabled } from "../apps/desktop/src/main/b01-candidate-capability";

describe("B01 package capability", () => {
  it("requires an exact marker in a packaged Candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "gmp-b01-marker-"));
    try {
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(false);
      writeFileSync(join(root, "r115-b01-hotfix.json"), JSON.stringify({ purpose: "R1.15-B01", candidate: "HOTFIX" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(true);
      expect(b01CandidateCapabilityEnabled(false, root)).toBe(false);
      writeFileSync(join(root, "r115-b01-hotfix.json"), JSON.stringify({ purpose: "R1.15-B01", candidate: "invalid" }));
      writeFileSync(join(root, B01_CANDIDATE_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "R2" }));
      expect(b01CandidateCapabilityEnabled(false, root)).toBe(false);
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(true);
      writeFileSync(join(root, B01_CANDIDATE_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "R1" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(false);
      writeFileSync(join(root, B01_CANDIDATE_R3_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "R3" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(true);
      writeFileSync(join(root, B01_CANDIDATE_R3_MARKER), JSON.stringify({ purpose: "R1.15-B01", candidate: "invalid" }));
      writeFileSync(join(root, "r115-b01-candidate-r4.json"), JSON.stringify({ purpose: "R1.15-B01", candidate: "R4" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(true);
      writeFileSync(join(root, "r115-b01-candidate-r4.json"), JSON.stringify({ purpose: "R1.15-B01", candidate: "invalid" }));
      expect(b01CandidateCapabilityEnabled(true, root)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
