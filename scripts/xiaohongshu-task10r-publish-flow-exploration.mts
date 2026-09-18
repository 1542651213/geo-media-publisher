import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export interface Task10rDbCounts {
  publishJobs: number;
  submissionIntents: number;
  publishRecords: number;
}

type JsonRecord = Record<string, unknown>;

const SECRET_KEY = /authorization|bearer|api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set-cookie|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|password|storagestate|token|credential|private|imagepath|profilepath|storage|image(?:data|content)|pixels?|screenshot/iu;
const SECRET_TEXT = /Bearer\s+[A-Za-z0-9._~+/=-]+|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|cookie|password|secret)\s*[=:]\s*[^\s,;&]+/iu;

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname || "/"}`;
  } catch {
    return "about:blank";
  }
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (SECRET_TEXT.test(value)) return value.replace(SECRET_TEXT, "[REDACTED]").slice(0, 240);
    return value.length > 240 ? value.slice(0, 240) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 80).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]));
  return value;
}

export function sanitizeTask10rDiagnostic(value: JsonRecord): JsonRecord {
  const sanitized = sanitizeValue(value) as JsonRecord;
  if (typeof sanitized.sanitizedUrl === "string") sanitized.sanitizedUrl = sanitizeUrl(sanitized.sanitizedUrl);
  if (typeof sanitized.sanitizedUrlBefore === "string") sanitized.sanitizedUrlBefore = sanitizeUrl(sanitized.sanitizedUrlBefore);
  if (typeof sanitized.sanitizedUrlAfter === "string") sanitized.sanitizedUrlAfter = sanitizeUrl(sanitized.sanitizedUrlAfter);
  if (typeof sanitized.currentUrl === "string") sanitized.currentUrl = sanitizeUrl(sanitized.currentUrl);
  return sanitized;
}

export function collectTask10rTimeline(diagnostics: readonly JsonRecord[]): readonly JsonRecord[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === "XHS_PUBLISH_FLOW_TIMELINE" && diagnostic.timelineEntry && typeof diagnostic.timelineEntry === "object")
    .map((diagnostic) => sanitizeTask10rDiagnostic(diagnostic.timelineEntry as JsonRecord))
    .sort((left, right) => String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")));
}

export function collectTask10rOperationEvidence(diagnostics: readonly JsonRecord[], operationId: string, accountId?: string): JsonRecord {
  const matched = diagnostics
    .filter((diagnostic) => diagnostic.operationId === operationId && diagnostic.platformKey === "xiaohongshu" && (accountId === undefined || diagnostic.accountId === accountId))
    .map(sanitizeTask10rDiagnostic)
    .sort((left, right) => String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")));
  const matchedAccountIds = new Set(matched.map((diagnostic) => diagnostic.accountId).filter((value): value is string => typeof value === "string"));
  if (accountId === undefined && matchedAccountIds.size > 1) throw new Error("TASK10R_OPERATION_AMBIGUOUS_ACCOUNT");
  const timeline = collectTask10rTimeline(matched);
  const actions = matched.filter((diagnostic) => diagnostic.code === "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION");
  const states = matched.filter((diagnostic) => typeof diagnostic.phase === "string" || diagnostic.code === "POST_UPLOAD_EDITOR_PHASE_OBSERVED");
  const selectors = matched.filter((diagnostic) => diagnostic.code === "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED" || diagnostic.code === "IMAGE_EDITOR_CONTROLS_DISCOVERED");
  const last = matched.at(-1) ?? {};
  const finalSubmitDiagnostic = [...matched].reverse().find((diagnostic) => diagnostic.finalSubmitControl && typeof diagnostic.finalSubmitControl === "object") ?? last;
  const maxNumber = (key: string): number => matched.reduce((maximum, diagnostic) => Math.max(maximum, typeof diagnostic[key] === "number" ? diagnostic[key] as number : 0), 0);
  const nestedCounter = (key: string): number => matched.reduce((maximum, diagnostic) => {
    const counters = diagnostic.counters;
    if (!counters || typeof counters !== "object" || Array.isArray(counters)) return maximum;
    const value = (counters as JsonRecord)[key];
    return Math.max(maximum, typeof value === "number" ? value : 0);
  }, 0);
  const counter = (key: string): number => Math.max(maxNumber(key), nestedCounter(key));
  return {
    task: "TASK_10R",
    operation: { operationId, platformKey: "xiaohongshu", accountId: accountId ?? [...matchedAccountIds][0] ?? null, mode: "XHS_PUBLISH_FLOW_EXPLORATION" },
    timeline,
    states,
    actions,
    selectors,
    counters: {
      uploadAttempts: counter("uploadAttempts"),
      uploadMutationCount: counter("uploadMutationCount"),
      uploadRetryCount: counter("uploadRetryCount"),
      intermediateActionClickCount: counter("intermediateActionClickCount"),
      titleMutationCount: counter("titleMutationCount"),
      bodyMutationCount: counter("bodyMutationCount"),
      settingsMutationCount: counter("settingsMutationCount"),
      contentMutationCount: counter("contentMutationCount"),
      finalSubmitCount: counter("finalSubmitCount")
    },
    finalSubmit: {
      status: finalSubmitDiagnostic.finalSubmitControl ? "OBSERVED" : "NOT_OBSERVED",
      visible: finalSubmitDiagnostic.finalSubmitVisible === true,
      enabled: finalSubmitDiagnostic.finalSubmitEnabled === true,
      hitTestValid: finalSubmitDiagnostic.finalSubmitHitTestValid === true
    },
    blocker: typeof last.failureCode === "string" ? last.failureCode : null,
    readyForFinalSubmit: last.status === "PASS_READY_FOR_FINAL_SUBMIT",
    safety: { finalSubmitCount: counter("finalSubmitCount") }
  };
}

export function readTask10rDbCounts(dbPath: string): Task10rDbCounts {
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const count = (table: "publish_jobs" | "submission_intents" | "publish_records"): number => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number };
      return Number(row.count ?? 0);
    };
    return { publishJobs: count("publish_jobs"), submissionIntents: count("submission_intents"), publishRecords: count("publish_records") };
  } finally {
    database.close();
  }
}

export function assertTask10rDbUnchanged(before: Task10rDbCounts, after: Task10rDbCounts): void {
  if (before.publishJobs !== after.publishJobs || before.submissionIntents !== after.submissionIntents || before.publishRecords !== after.publishRecords) {
    throw new Error(`TASK10R_DB_CHANGED: ${JSON.stringify({ before, after })}`);
  }
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : null;
}

function readJsonLines(path: string): JsonRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/u).map((line) => {
    try { return JSON.parse(line) as JsonRecord; } catch { return null; }
  }).filter((line): line is JsonRecord => line !== null);
}

export function writeTask10rEvidence(outputPath: string, evidence: JsonRecord): string {
  const finalSubmitCount = typeof evidence.finalSubmitCount === "number"
    ? evidence.finalSubmitCount
    : typeof evidence.safety === "object" && evidence.safety !== null && !Array.isArray(evidence.safety) && typeof (evidence.safety as JsonRecord).finalSubmitCount === "number"
      ? (evidence.safety as JsonRecord).finalSubmitCount as number
      : typeof evidence.counters === "object" && evidence.counters !== null && !Array.isArray(evidence.counters) && typeof (evidence.counters as JsonRecord).finalSubmitCount === "number"
        ? (evidence.counters as JsonRecord).finalSubmitCount as number
        : 0;
  if (finalSubmitCount !== 0) throw new Error("TASK10R_FINAL_SUBMIT_BOUNDARY_VIOLATION");
  const database = evidence.database;
  if (database && typeof database === "object" && !Array.isArray(database)) {
    const before = (database as JsonRecord).before;
    const after = (database as JsonRecord).after;
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) throw new Error("TASK10R_DB_CHANGED");
  }
  const target = resolve(outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(evidence, null, 2), "utf8");
  return target;
}

if (process.argv[1]?.endsWith("xiaohongshu-task10r-publish-flow-exploration.mts")) {
  const operationId = argumentValue(process.argv, "--operation-id");
  const logPath = argumentValue(process.argv, "--log-path");
  const dbPath = argumentValue(process.argv, "--db-path");
  const outputPath = argumentValue(process.argv, "--output") ?? "output/xiaohongshu-task10r-publish-flow-exploration.json";
  if (!operationId) throw new Error("--operation-id is required");
  const evidence = collectTask10rOperationEvidence(logPath ? readJsonLines(resolve(logPath)) : [], operationId);
  if (dbPath) evidence.database = { observed: readTask10rDbCounts(resolve(dbPath)) };
  writeTask10rEvidence(outputPath, evidence);
}
