import { win32 } from "node:path";
import { z } from "zod";

export const FORMAL_XHS_PRODUCTION_PILOT_ID = "GEO_XHS_PRODUCTION_PILOT_MAX3_20260918";
export const FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC = "2026-09-18T14:59:59Z";
export const FORMAL_XHS_PRODUCTION_PILOT_GATE = "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918";

const sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/u);
const schema = z.object({
  version: z.literal(1),
  pilotId: z.literal(FORMAL_XHS_PRODUCTION_PILOT_ID),
  expiresAtUtc: z.literal(FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC),
  maxFinalSubmissions: z.literal(3),
  executablePath: z.string().min(1),
  executableSha256: sha256,
  appAsarPath: z.string().min(1),
  appAsarSha256: sha256
}).strict();

export type FormalXhsProductionPilotConfig = z.infer<typeof schema>;

const samePath = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();

/** A process must carry both owner-controlled values; neither has a default. */
export function readFormalXhsProductionPilotGate(env: Record<string, string | undefined>): string | null {
  const flag = env.GEO_XHS_PRODUCTION_PILOT;
  const configPath = env.GEO_XHS_PRODUCTION_PILOT_CONFIG;
  if (flag === undefined && configPath === undefined) return null;
  if (flag !== FORMAL_XHS_PRODUCTION_PILOT_GATE || !configPath || win32.extname(configPath).toLowerCase() !== ".json") {
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
    appAsarSha256: parsed.appAsarSha256.toLowerCase()
  };
}
