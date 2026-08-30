import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import {
  analyzeTask10AEvidence,
  type PublishDomainCounts
} from "./v143-xiaohongshu-task10a-evidence.helpers";

type CliOptions = {
  platformKey: string;
  accountId: string;
  logPath: string;
  databasePath: string;
  outputPath: string;
  operationId?: string;
  from?: string;
  to?: string;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const dataDirectory = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data");
  const options: CliOptions = {
    platformKey: "xiaohongshu",
    accountId: "",
    logPath: join(dataDirectory, "logs", "app.log"),
    databasePath: join(dataDirectory, "publisher.db"),
    outputPath: resolve(process.cwd(), "output", "v143-xiaohongshu-task10a-latest-evidence.json")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--platform-key": options.platformKey = requireValue(argv, index++, flag); break;
      case "--account-id": options.accountId = requireValue(argv, index++, flag); break;
      case "--log": options.logPath = resolve(requireValue(argv, index++, flag)); break;
      case "--db": options.databasePath = resolve(requireValue(argv, index++, flag)); break;
      case "--output": options.outputPath = resolve(requireValue(argv, index++, flag)); break;
      case "--operation-id": options.operationId = requireValue(argv, index++, flag); break;
      case "--from": options.from = requireValue(argv, index++, flag); break;
      case "--to": options.to = requireValue(argv, index++, flag); break;
      case "--help":
        console.log("Usage: pnpm exec tsx scripts/v143-xiaohongshu-task10a-evidence.mts --account-id <id> [--platform-key xiaohongshu] [--log <path>] [--db <path>] [--output <path>] [--operation-id <id>] [--from <ISO>] [--to <ISO>]");
        process.exit(0);
        break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.accountId) throw new Error("--account-id is required");
  return options;
}

function readPublishDomainCounts(databasePath: string): PublishDomainCounts {
  if (!existsSync(databasePath)) throw new Error(`Production DB does not exist: ${databasePath}`);
  const python = [
    "import json, sqlite3, sys",
    "path = sys.argv[1].replace('\\\\', '/')",
    "db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)",
    "try:",
    "  names = ('publish_jobs', 'submission_intents', 'publish_records')",
    "  print(json.dumps({name: db.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0] for name in names}))",
    "finally:",
    "  db.close()"
  ].join("\n");
  let output: string;
  try {
    output = execFileSync("python", ["-c", python, databasePath], { encoding: "utf8" });
  } catch (pythonError) {
    try {
      output = execFileSync("py", ["-3", "-c", python, databasePath], { encoding: "utf8" });
    } catch {
      throw pythonError;
    }
  }
  const counts = JSON.parse(output) as Record<string, unknown>;
  return { publishJobs: Number(counts.publish_jobs ?? 0), submissionIntents: Number(counts.submission_intents ?? 0), publishRecords: Number(counts.publish_records ?? 0) };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.logPath)) throw new Error(`App log does not exist: ${options.logPath}`);
  const summary = analyzeTask10AEvidence({
    logText: readFileSync(options.logPath, "utf8"),
    platformKey: options.platformKey,
    accountId: options.accountId,
    ...(options.operationId ? { operationId: options.operationId } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    publishDomainCounts: readPublishDomainCounts(options.databasePath)
  });
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath: options.outputPath, gateOperationId: summary.gateOperationId, gateResult: summary.gateResult, evidenceAmbiguous: summary.evidenceAmbiguous, publishDomainCounts: summary.publishDomainCounts }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
