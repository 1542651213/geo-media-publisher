import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type DiagnosticStream = { writable?: boolean; destroyed?: boolean };
type DiagnosticProcess = { pid: number; ppid: number; stdout?: unknown; stderr?: unknown };

export interface ProcessDiagnostics {
  record(event: string, details?: Record<string, unknown>): void;
  recordIpcError(channel: string, error: unknown): void;
  installProcessHandlers(): void;
}

const SENSITIVE_KEY = /^(authorization|bearer|api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set-cookie|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|password|session|storageState|token)$/iu;

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/(\b(?:cookie|token|session|secret|password|authorization|api[_-]?key|storageState)\b\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/giu, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}

function streamState(stream: unknown): { writable: boolean | null; destroyed: boolean | null } {
  if (!stream || typeof stream !== "object") return { writable: null, destroyed: null };
  const candidate = stream as DiagnosticStream;
  return { writable: typeof candidate.writable === "boolean" ? candidate.writable : null, destroyed: typeof candidate.destroyed === "boolean" ? candidate.destroyed : null };
}

function errorState(error: unknown): { name: string; message: string; stack: string | null } {
  if (error instanceof Error) return { name: error.name, message: redactDiagnosticText(error.message), stack: error.stack ? redactDiagnosticText(error.stack) : null };
  if (typeof error === "string") return { name: "NonErrorRejection", message: redactDiagnosticText(error), stack: null };
  return { name: "NonErrorRejection", message: redactDiagnosticText(String(error)), stack: null };
}

function safeDetails(value: unknown): unknown {
  if (typeof value === "string") return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map(safeDetails);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : key === "error" ? errorState(item) : safeDetails(item)]));
}

export function createProcessDiagnostics(filePath: string, processRef: DiagnosticProcess = process): ProcessDiagnostics {
  const record = (event: string, details: Record<string, unknown> = {}): void => {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event, pid: processRef.pid, ppid: processRef.ppid, stdio: { stdout: streamState(processRef.stdout), stderr: streamState(processRef.stderr) }, ...(safeDetails(details) as Record<string, unknown>) })}\n`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, line, "utf8");
    } catch {
      // Diagnostics must never write to stdout/stderr while those pipes are suspect.
    }
  };
  return {
    record,
    recordIpcError: (channel, error) => record("IPC_HANDLER_ERROR", { channel, error }),
    installProcessHandlers: () => {
      process.on("uncaughtException", (error) => record("UNCAUGHT_EXCEPTION", { error }));
      process.on("unhandledRejection", (reason) => record("UNHANDLED_REJECTION", { error: reason }));
    }
  };
}
