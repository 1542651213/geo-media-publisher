import { win32 } from "node:path";
import { z } from "zod";

const same = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
const contained = (parent: string, child: string): boolean => {
  const root = win32.resolve(parent).toLowerCase();
  const target = win32.resolve(child).toLowerCase();
  return target === root || target.startsWith(`${root}\\`);
};
const absolute = (value: string): boolean => win32.isAbsolute(value);
const schema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u),
  runDirectory: z.string(),
  executablePath: z.string(),
  executableSha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
  appAsarPath: z.string(),
  appAsarSha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
  token: z.string().regex(/^[a-zA-Z0-9_-]{32,128}$/u),
  allowRecovery: z.boolean()
}).strict();
export type OrdinaryPilotConfiguration = z.infer<typeof schema>;

export function readOrdinaryPilotGate(environment: Record<string, string | undefined>): string | null {
  const flag = environment.ORDINARY_XHS_PILOT;
  const path = environment.ORDINARY_XHS_PILOT_CONFIG;
  if (flag === undefined && path === undefined) return null;
  if (flag !== "SYNTHETIC_ONLY" || !path || !absolute(path) || win32.extname(path).toLowerCase() !== ".json") throw new Error("ORDINARY_PILOT_EXPLICIT_DUAL_GATE_REQUIRED");
  return win32.resolve(path);
}

export function parseOrdinaryPilotConfiguration(input: unknown, configurationPath?: string): OrdinaryPilotConfiguration {
  const config = schema.parse(input);
  if (![config.runDirectory, config.executablePath, config.appAsarPath].every(absolute)) throw new Error("ORDINARY_PILOT_ABSOLUTE_PATH_REQUIRED");
  const runDirectory = win32.resolve(config.runDirectory);
  const executablePath = win32.resolve(config.executablePath);
  const appAsarPath = win32.resolve(config.appAsarPath);
  if (configurationPath && !same(win32.dirname(configurationPath), runDirectory)) throw new Error("ORDINARY_PILOT_CONFIG_PATH_INVALID");
  if (contained(runDirectory, executablePath) || contained(runDirectory, appAsarPath) || win32.extname(executablePath).toLowerCase() !== ".exe") throw new Error("ORDINARY_PILOT_EXECUTABLE_INVALID");
  if (!same(appAsarPath, win32.join(win32.dirname(executablePath), "resources", "app.asar"))) throw new Error("ORDINARY_PILOT_ASAR_INVALID");
  return { ...config, runDirectory, executablePath, appAsarPath, executableSha256: config.executableSha256.toLowerCase(), appAsarSha256: config.appAsarSha256.toLowerCase() };
}
