import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-fA-F]{64}$/u);
const same = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
const inside = (parent: string, child: string): boolean => {
  const root = win32.resolve(parent).toLowerCase();
  const target = win32.resolve(child).toLowerCase();
  return target === root || target.startsWith(`${root}\\`);
};
const absolute = (value: string): boolean => win32.isAbsolute(value);
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * A scoped live campaign is configured outside the source tree. The public
 * source contains no owner account, content, package path, deadline, or gate.
 */
const schema = z.object({
  version: z.literal(1),
  campaignId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{2,79}$/u),
  runDirectory: z.string(),
  executablePath: z.string(),
  executableSha256: sha,
  appAsarPath: z.string(),
  appAsarSha256: sha,
  manifestPath: z.string(),
  manifestSha256: sha,
  authorizationSha256: sha,
  covers: z.array(z.object({ slot: z.enum(["XHS-01", "XHS-02", "XHS-03"]), sha256: sha }).strict()).length(3),
  accountId: z.string().uuid(),
  creatorId: z.string().regex(/^[0-9]{4,20}$/u),
  expiresAtUtc: z.string().datetime({ offset: true })
}).strict();

export type XhsMax3Config = z.infer<typeof schema>;

export function readXhsMax3Gate(env: Record<string, string | undefined>): string | null {
  const authorization = env.GEO_XHS_MAX3;
  const path = env.GEO_XHS_MAX3_CONFIG;
  if (authorization === undefined && path === undefined) return null;
  if (!authorization || !path || !absolute(path) || win32.extname(path).toLowerCase() !== ".json") throw new Error("XHS_MAX3_EXPLICIT_DUAL_GATE_REQUIRED");
  return win32.resolve(path);
}

export function parseXhsMax3Config(value: unknown, configPath?: string): XhsMax3Config {
  const config = schema.parse(value);
  if (![config.runDirectory, config.executablePath, config.appAsarPath, config.manifestPath].every(absolute)) throw new Error("XHS_MAX3_ABSOLUTE_PATH_REQUIRED");
  const runDirectory = win32.resolve(config.runDirectory);
  const executablePath = win32.resolve(config.executablePath);
  const appAsarPath = win32.resolve(config.appAsarPath);
  const manifestPath = win32.resolve(config.manifestPath);
  if (configPath && !inside(runDirectory, configPath)) throw new Error("XHS_MAX3_CONFIG_PATH_MISMATCH");
  if (!inside(runDirectory, manifestPath) || inside(runDirectory, executablePath) || inside(runDirectory, appAsarPath)) throw new Error("XHS_MAX3_ISOLATION_PATH_MISMATCH");
  if (!same(appAsarPath, win32.join(win32.dirname(executablePath), "resources", "app.asar"))) throw new Error("XHS_MAX3_PACKAGE_LAYOUT_MISMATCH");
  if (config.covers.some((cover, index) => cover.slot !== `XHS-0${index + 1}`)) throw new Error("XHS_MAX3_SLOT_ORDER_MISMATCH");
  return {
    ...config,
    runDirectory,
    executablePath,
    appAsarPath,
    manifestPath,
    executableSha256: config.executableSha256.toLowerCase(),
    appAsarSha256: config.appAsarSha256.toLowerCase(),
    manifestSha256: config.manifestSha256.toLowerCase(),
    authorizationSha256: config.authorizationSha256.toLowerCase()
  };
}

export function authorizeXhsMax3Config(config: XhsMax3Config, authorization: string | undefined): void {
  if (!authorization || digest(authorization) !== config.authorizationSha256) throw new Error("XHS_MAX3_AUTHORIZATION_MISMATCH");
}
