import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const OFFICIAL_API_ACCEPTANCE_MARKER = "r115-c-official-api-acceptance.json";
const selectionSchema = z.strictObject({ accountId: z.string().min(1).max(128), articleId: z.string().min(1).max(128),
  siteId: z.literal("kangyi"), environment: z.enum(["staging", "production"]), keyId: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/u),
  kind: z.enum(["article", "case"]), contentBindingId: z.string().regex(/^[a-f0-9]{64}$/u), acceptanceRunId: z.uuid().optional() });
export type OfficialApiAcceptanceSelection = z.infer<typeof selectionSchema> & { expiresAt: string };
const markerSchema = z.strictObject({ purpose: z.literal("R1.15-C-OFFICIALAPI-ACCEPTANCE"), version: z.literal(1),
  expiresAt: z.iso.datetime(), selections: z.array(selectionSchema).min(1).max(3) });

/** Temporary package-owned authority; an IPC payload or environment flag cannot create it. */
export function readOfficialApiAcceptance(packaged: boolean, resourcesPath: string): OfficialApiAcceptanceSelection[] {
  if (!packaged) return [];
  try {
    const path = join(resourcesPath, OFFICIAL_API_ACCEPTANCE_MARKER);
    if (!statSync(path).isFile() || statSync(path).size > 16384) return [];
    const marker = markerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const remaining = new Date(marker.expiresAt).getTime() - Date.now();
    if (remaining <= 0 || remaining > 7 * 24 * 60 * 60_000) return [];
    const production = marker.selections.filter(value => value.environment === "production");
    if (production.length > 1 || production.some(value => value.acceptanceRunId)) return [];
    if (new Set(marker.selections.map(value => `${value.accountId}:${value.articleId}`)).size !== marker.selections.length) return [];
    return marker.selections.map(selection => ({ ...selection, expiresAt: marker.expiresAt }));
  } catch { return []; }
}

export function candidateGrantActive(grant: OfficialApiAcceptanceSelection): boolean {
  const expires = Date.parse(grant.expiresAt);
  return Number.isFinite(expires) && expires > Date.now();
}

export function candidateBindingAllowed(grants: readonly OfficialApiAcceptanceSelection[], binding: {
  accountId: string; articleId: string; siteId: string; environment: string; keyId: string; kind: string; contentBindingId: string
}): boolean {
  return grants.some(grant => candidateGrantActive(grant) && grant.accountId === binding.accountId && grant.articleId === binding.articleId
    && grant.siteId === binding.siteId && grant.environment === binding.environment && grant.keyId === binding.keyId
    && grant.kind === binding.kind && grant.contentBindingId === binding.contentBindingId);
}
