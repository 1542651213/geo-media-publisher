import { readFileSync } from "node:fs";
import { join } from "node:path";

export const B01_CANDIDATE_MARKER = "r115-b01-candidate-r2.json";
export const B01_CANDIDATE_R3_MARKER = "r115-b01-candidate-r3.json";
export const B01_CANDIDATE_R4_MARKER = "r115-b01-candidate-r4.json";

/** Explicit extraResource keeps ordinary builds closed even when the code is present. */
export function b01CandidateCapabilityEnabled(packaged: boolean, resourcesPath: string): boolean {
  if (!packaged) return false;
  return ([{ file: B01_CANDIDATE_MARKER, candidate: "R2" }, { file: B01_CANDIDATE_R3_MARKER, candidate: "R3" },
    { file: B01_CANDIDATE_R4_MARKER, candidate: "R4" }] as const).some(({ file, candidate }) => {
    try {
      const marker: unknown = JSON.parse(readFileSync(join(resourcesPath, file), "utf8"));
      return Boolean(marker && typeof marker === "object" && !Array.isArray(marker)
        && "purpose" in marker && marker.purpose === "R1.15-B01"
        && "candidate" in marker && marker.candidate === candidate);
    } catch { return false; }
  });
}
