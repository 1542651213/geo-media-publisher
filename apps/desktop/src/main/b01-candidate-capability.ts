import { readFileSync } from "node:fs";
import { join } from "node:path";

export const B01_CANDIDATE_MARKER = "r115-b01-candidate-r2.json";

/** Explicit extraResource keeps ordinary builds closed even when the code is present. */
export function b01CandidateCapabilityEnabled(packaged: boolean, resourcesPath: string): boolean {
  if (!packaged) return false;
  try {
    const marker: unknown = JSON.parse(readFileSync(join(resourcesPath, B01_CANDIDATE_MARKER), "utf8"));
    return Boolean(marker && typeof marker === "object" && !Array.isArray(marker)
      && "purpose" in marker && marker.purpose === "R1.15-B01"
      && "candidate" in marker && marker.candidate === "R2");
  } catch { return false; }
}
