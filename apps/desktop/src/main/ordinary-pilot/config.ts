import { win32 } from "node:path";
import { z } from "zod";

const root = "D:/GEO/repairs/batch1-v0-f01-20260917";
const runs = win32.resolve(root, "runtime/ordinary-xhs-pilot");
const same = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
const contained = (parent: string, child: string): boolean => win32.resolve(child).toLowerCase().startsWith(win32.resolve(parent).toLowerCase() + "\\");
const schema = z.object({ version: z.literal(1), runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u), runDirectory: z.string(), executablePath: z.string(), executableSha256: z.string().regex(/^[a-fA-F0-9]{64}$/u), appAsarPath: z.string(), appAsarSha256: z.string().regex(/^[a-fA-F0-9]{64}$/u), token: z.string().regex(/^[a-zA-Z0-9_-]{32,128}$/u), allowRecovery: z.boolean() }).strict();
export type OrdinaryPilotConfiguration = z.infer<typeof schema>;

export function readOrdinaryPilotGate(environment: Record<string, string | undefined>): string | null {
  const flag = environment.ORDINARY_XHS_PILOT;
  const path = environment.ORDINARY_XHS_PILOT_CONFIG;
  if (flag === undefined && path === undefined) return null;
  if (flag !== "SYNTHETIC_ONLY" || !path || !contained(runs, path) || win32.extname(path).toLowerCase() !== ".json") throw new Error("ORDINARY_PILOT_EXPLICIT_DUAL_GATE_REQUIRED");
  return win32.resolve(path);
}

export function parseOrdinaryPilotConfiguration(input: unknown): OrdinaryPilotConfiguration {
  const config = schema.parse(input);
  if (!same(config.runDirectory, win32.join(runs, config.runId))) throw new Error("ORDINARY_PILOT_RUN_DIRECTORY_INVALID");
  if (!contained(root, config.executablePath) || contained(win32.join(root, "source"), config.executablePath) || win32.extname(config.executablePath).toLowerCase() !== ".exe") throw new Error("ORDINARY_PILOT_EXECUTABLE_INVALID");
  if (!same(config.appAsarPath, win32.join(win32.dirname(config.executablePath), "resources/app.asar"))) throw new Error("ORDINARY_PILOT_ASAR_INVALID");
  return { ...config, runDirectory: win32.resolve(config.runDirectory), executablePath: win32.resolve(config.executablePath), appAsarPath: win32.resolve(config.appAsarPath), executableSha256: config.executableSha256.toLowerCase(), appAsarSha256: config.appAsarSha256.toLowerCase() };
}
