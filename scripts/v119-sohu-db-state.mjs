import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const jobId = process.argv[3] ?? "3993bc2f-73f8-4738-a321-2baf73e9d6cd";
const databasePath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/publisher.db";
const outputPath = join(process.cwd(), "output", `v119-sohu-db-state-${process.argv[2] ?? "snapshot"}.json`);
const db = new Database(databasePath, { readonly: true });
try {
  const job = db.prepare("SELECT id,account_id,platform_account_id,platform_key,status,last_error_code,last_error_message,external_id,finished_at FROM publish_jobs WHERE id=?").get(jobId) ?? null;
  const intent = db.prepare("SELECT job_id,state,external_id,final_submit_count,error_code,updated_at FROM submission_intents WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId) ?? null;
  const record = db.prepare("SELECT id,status,success,published_url,published_external_id,verification_status,response_json FROM publish_records WHERE job_id=? ORDER BY published_at DESC LIMIT 1").get(jobId) ?? null;
  const parsedRecord = record && typeof record === "object" ? { ...record, response: typeof record.response_json === "string" ? JSON.parse(record.response_json) : {} } : record;
  const evidence = { capturedAt: new Date().toISOString(), jobId, job, intent, record: parsedRecord };
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, status: job?.status ?? null, finalSubmitCount: intent?.final_submit_count ?? null, recordStatus: record?.status ?? null }));
} finally {
  db.close();
}
app.quit();
setTimeout(() => process.exit(0), 250).unref();
