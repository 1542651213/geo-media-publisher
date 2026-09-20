import { win32 } from "node:path";
import { z } from "zod";

export const FORMAL_XHS_PRODUCTION_PILOT_ID = "GEO_XHS_PRODUCTION_PILOT_MAX3_20260918";
export const FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC = "2026-09-18T14:59:59Z";
export const FORMAL_XHS_PRODUCTION_PILOT_GATE = "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918";
export const FORMAL_XHS_UNTIL_REVOKED_PILOT_ID = "GEO_XHS_PRODUCTION_PILOT_SINGLE_UNTIL_REVOKED_20260919";
export const FORMAL_XHS_UNTIL_REVOKED_STORAGE_EXPIRY_UTC = "9999-12-31T23:59:59.999Z";
export const FORMAL_XHS_UNTIL_REVOKED_PILOT_GATE = "OWNER_AUTHORIZED_PRODUCTION_PILOT_SINGLE_UNTIL_REVOKED_20260919";

const sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/u);
const crossBrandImageBindingAuthorization = z.object({
  articleId: z.string().uuid().optional(),
  articleBrandId: z.string().uuid(),
  articleTitleSha256: sha256.optional(),
  articleBodySha256: sha256.optional(),
  imageAssetId: z.string().uuid(),
  imageBrandId: z.string().uuid(),
  imageSha256: sha256
}).strict().superRefine((value, context) => {
  if (!value.articleId && (!value.articleTitleSha256 || !value.articleBodySha256)) context.addIssue({ code: z.ZodIssueCode.custom, message: "CROSS_BRAND_IMAGE_ARTICLE_BINDING_REQUIRED" });
  if ((value.articleTitleSha256 && !value.articleBodySha256) || (!value.articleTitleSha256 && value.articleBodySha256)) context.addIssue({ code: z.ZodIssueCode.custom, message: "CROSS_BRAND_IMAGE_CONTENT_BINDING_INCOMPLETE" });
});
const schema = z.object({
  version: z.literal(1),
  pilotId: z.union([z.literal(FORMAL_XHS_PRODUCTION_PILOT_ID), z.literal(FORMAL_XHS_UNTIL_REVOKED_PILOT_ID)]),
  expiresAtUtc: z.union([z.literal(FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC), z.literal(FORMAL_XHS_UNTIL_REVOKED_STORAGE_EXPIRY_UTC)]),
  maxFinalSubmissions: z.union([z.literal(1), z.literal(3)]),
  executablePath: z.string().min(1),
  executableSha256: sha256,
  appAsarPath: z.string().min(1),
  appAsarSha256: sha256,
  /** Required by the packaged runtime; optional here for offline parser tests. */
  xhsAccountId: z.string().uuid().optional(),
  crossBrandImageBindingAuthorization: crossBrandImageBindingAuthorization.optional(),
  authorizationMode: z.literal("UNTIL_REVOKED").optional()
}).strict().superRefine((value, context) => {
  const historical = value.pilotId === FORMAL_XHS_PRODUCTION_PILOT_ID;
  if (historical && (value.expiresAtUtc !== FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC || value.maxFinalSubmissions !== 3 || value.authorizationMode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "FORMAL_XHS_PRODUCTION_PILOT_DEFINITION_MISMATCH" });
  if (!historical && (value.expiresAtUtc !== FORMAL_XHS_UNTIL_REVOKED_STORAGE_EXPIRY_UTC || value.maxFinalSubmissions !== 1 || value.authorizationMode !== "UNTIL_REVOKED")) context.addIssue({ code: z.ZodIssueCode.custom, message: "FORMAL_XHS_UNTIL_REVOKED_SINGLE_DEFINITION_MISMATCH" });
});

export type FormalXhsProductionPilotConfig = z.infer<typeof schema>;

const samePath = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();

/** A process must carry both owner-controlled values; neither has a default. */
export function readFormalXhsProductionPilotGate(env: Record<string, string | undefined>): string | null {
  const flag = env.GEO_XHS_PRODUCTION_PILOT;
  const configPath = env.GEO_XHS_PRODUCTION_PILOT_CONFIG;
  if (flag === undefined && configPath === undefined) return null;
  if (![FORMAL_XHS_PRODUCTION_PILOT_GATE, FORMAL_XHS_UNTIL_REVOKED_PILOT_GATE].includes(flag ?? "") || !configPath || win32.extname(configPath).toLowerCase() !== ".json") {
    throw new Error("FORMAL_XHS_PRODUCTION_PILOT_DUAL_GATE_REQUIRED");
  }
  return win32.resolve(configPath);
}

/** The task definition is fixed; only the exact full-package identity varies. */
export function parseFormalXhsProductionPilotConfig(value: unknown): FormalXhsProductionPilotConfig {
  const parsed = schema.parse(value);
  const executablePath = win32.resolve(parsed.executablePath);
  const appAsarPath = win32.resolve(parsed.appAsarPath);
  if (win32.basename(executablePath).toLowerCase() !== "geo media publisher.exe" || !samePath(appAsarPath, win32.join(win32.dirname(executablePath), "resources", "app.asar"))) {
    throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PACKAGE_PATH_MISMATCH");
  }
  return {
    ...parsed,
    executablePath,
    appAsarPath,
    executableSha256: parsed.executableSha256.toLowerCase(),
    appAsarSha256: parsed.appAsarSha256.toLowerCase(),
    ...(parsed.crossBrandImageBindingAuthorization ? {
      crossBrandImageBindingAuthorization: {
        ...parsed.crossBrandImageBindingAuthorization,
        ...(parsed.crossBrandImageBindingAuthorization.articleTitleSha256 ? { articleTitleSha256: parsed.crossBrandImageBindingAuthorization.articleTitleSha256.toLowerCase() } : {}),
        ...(parsed.crossBrandImageBindingAuthorization.articleBodySha256 ? { articleBodySha256: parsed.crossBrandImageBindingAuthorization.articleBodySha256.toLowerCase() } : {}),
        imageSha256: parsed.crossBrandImageBindingAuthorization.imageSha256.toLowerCase()
      }
    } : {})
  };
}
