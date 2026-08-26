import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActivityLog } from "@publisher/domain";

const SENSITIVE_KEY = /^(authorization|bearer|api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set-cookie|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|password|storagestate|token)$/iu;

export interface Logger {
  info(module: string, code: string, message: string, context?: Record<string, unknown>): void;
  warn(module: string, code: string, message: string, context?: Record<string, unknown>): void;
  error(module: string, code: string, message: string, context?: Record<string, unknown>): void;
}

export function createConsoleLogger(): Logger {
  const write = (level: ActivityLog["level"], module: string, code: string, message: string, context: Record<string, unknown>): void => {
    const line = JSON.stringify(sanitizeValue({ timestamp: new Date().toISOString(), level, module, code, message, context }));
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };
  return { info: (m, c, msg, ctx = {}) => write("info", m, c, msg, ctx), warn: (m, c, msg, ctx = {}) => write("warn", m, c, msg, ctx), error: (m, c, msg, ctx = {}) => write("error", m, c, msg, ctx) };
}

export function createFileLogger(filePath: string, fallback: Logger = createConsoleLogger()): Logger {
  const write = (level: ActivityLog["level"], module: string, code: string, message: string, context: Record<string, unknown>): void => {
    const line = `${JSON.stringify(sanitizeValue({ timestamp: new Date().toISOString(), level, module, code, message, context }))}\n`;
    void mkdir(dirname(filePath), { recursive: true }).then(() => appendFile(filePath, line, "utf8")).catch(() => fallback.error("LOGGER", "FILE_WRITE_FAILED", "本地日志文件写入失败", { filePath }));
    if (level === "error") fallback.error(module, code, message, context);
    else if (level === "warn") fallback.warn(module, code, message, context);
    else fallback.info(module, code, message, context);
  };
  return { info: (m, c, msg, ctx = {}) => write("info", m, c, msg, ctx), warn: (m, c, msg, ctx = {}) => write("warn", m, c, msg, ctx), error: (m, c, msg, ctx = {}) => write("error", m, c, msg, ctx) };
}

export async function exportLogBundle(input: { outputPath: string; applicationLogPath?: string; errorLogPath?: string; diagnostics: Record<string, unknown>; artifacts?: string[] }): Promise<string> {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const item of [{ name: "application.log", path: input.applicationLogPath }, { name: "error.log", path: input.errorLogPath }]) {
    if (!item.path) continue;
    try { files.push({ name: item.name, data: new TextEncoder().encode(sanitizeText(await readFile(item.path, "utf8"))) }); } catch { /* optional log file */ }
  }
  files.push({ name: "sanitized-diagnostics.json", data: new TextEncoder().encode(JSON.stringify(sanitizeValue(input.diagnostics), null, 2)) });
  for (const artifact of input.artifacts ?? []) {
    try { files.push({ name: `debug/${artifact.split(/[\\/]/u).pop() ?? "artifact"}`, data: new Uint8Array(await readFile(artifact)) }); } catch { /* optional artifact */ }
  }
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, makeStoredZip(files));
  return input.outputPath;
}

export function sanitizeText(value: string): string {
  return value
    .replace(/("?(?:api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set-cookie|authorization|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|storageState|token|password)"?\s*[:=]\s*")([^"\r\n]+)(")/giu, "$1[REDACTED]$3")
    .replace(/([?&](?:api[_-]?key|apikey|appsecret|client[_-]?secret|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|token)=)[^&#\s]+/giu, "$1[REDACTED]")
    .replace(/\b((?:access[_-]?token|refresh[_-]?token|api[_-]?key|appsecret|client[_-]?secret|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|token)\s*=\s*)(?!["'])[^&\s]+/giu, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}

export function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => SENSITIVE_KEY.test(key) ? [key, "[REDACTED]"] : [key, sanitizeValue(item)]));
  return value;
}

function makeStoredZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0, true); view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint32(14, crc, true); view.setUint32(18, file.data.length, true); view.setUint32(22, file.data.length, true); view.setUint16(26, name.length, true); view.setUint16(28, 0, true); local.set(name, 30);
    chunks.push(local, file.data);
    const entry = new Uint8Array(46 + name.length);
    const centralView = new DataView(entry.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true); centralView.setUint16(8, 0, true); centralView.setUint16(10, 0, true); centralView.setUint16(12, 0, true); centralView.setUint16(14, 0, true); centralView.setUint32(16, crc, true); centralView.setUint32(20, file.data.length, true); centralView.setUint32(24, file.data.length, true); centralView.setUint16(28, name.length, true); centralView.setUint16(30, 0, true); centralView.setUint16(32, 0, true); centralView.setUint16(34, 0, true); centralView.setUint16(36, 0, true); centralView.setUint32(38, 0, true); centralView.setUint32(42, offset, true); entry.set(name, 46); central.push(entry); offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer); endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length); let cursor = 0;
  for (const chunk of [...chunks, ...central, end]) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
