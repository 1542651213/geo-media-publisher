import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./index";

const migrations = join(process.cwd(), "packages/db/migrations");
const sql = readFileSync(join(migrations, "0029_douyin_publish_content_outcome.sql"), "utf8");
describe("additive Douyin outcome migration", () => {
  it("keeps the empty authorization and outcome tables empty across migration/restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "douyin-outcome-restart-"));
    try {
      for (let restart = 0; restart < 2; restart++) {
        const { db } = openDatabase(join(dir, "isolated.db"), migrations);
        try {
          expect(db.prepare("SELECT count(*) n FROM douyin_publish_outcomes").get()).toEqual({ n: 0 });
          expect(db.prepare("SELECT count(*) n FROM b01_product_e2e_authorization").get()).toEqual({ n: 0 });
          expect(db.prepare("SELECT count(*) n FROM migrations WHERE id='0029_douyin_publish_content_outcome.sql'").get()).toEqual({ n: 1 });
          expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
          expect(db.pragma("foreign_key_check")).toEqual([]);
        } finally { db.close(); }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("appends the exact Owner accepted interpretation without mutating any original submit row", () => {
    for (const credible of [true, false]) {
      const db = new Database(":memory:");
      try {
        db.exec(`PRAGMA foreign_keys=ON;
          CREATE TABLE publish_jobs(id TEXT PRIMARY KEY,platform_key TEXT,status TEXT);
          CREATE TABLE publish_records(id TEXT PRIMARY KEY,job_id TEXT,published_external_id TEXT,status TEXT,success INTEGER,response_json TEXT);
          CREATE TABLE submission_intents(id TEXT PRIMARY KEY,job_id TEXT,final_submit_count INTEGER,external_id TEXT,remote_status TEXT);`);
        const job = "ee500df1-8dd7-4cae-b047-dece77884874";
        db.prepare("INSERT INTO publish_jobs VALUES (?,'douyin','Success')").run(job);
        db.prepare("INSERT INTO publish_records VALUES (?,?,?,'Published',1,?)")
          .run("f79087cb-b574-4c46-b22e-f6311106f54d", job, "7691247987888016655",
            JSON.stringify({ finalActionCount: 1, reconciliation: { readOnly: true, matchedBy: "REMOTE_ID", remoteState: "PUBLISHED",
              exactRemoteIdMatch: credible, managementCardCount: 1 } }));
        db.prepare("INSERT INTO submission_intents VALUES (?,?,1,?,'PUBLISHED_MANAGEMENT')")
          .run("5f2f0c33-0f8b-4c2b-b068-78eaa88cbbcc", job, "7691247987888016655");
        const original = ["publish_jobs", "publish_records", "submission_intents"].map(table => db.prepare(`SELECT * FROM ${table}`).all());
        db.exec(sql);
        expect(["publish_jobs", "publish_records", "submission_intents"].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(original);
        const rows = db.prepare("SELECT * FROM douyin_publish_outcomes").all();
        expect(rows).toHaveLength(credible ? 1 : 0);
        if (credible) expect(rows[0]).toMatchObject({ publish_result: "PUBLISHED_CONFIRMED", management_page_verified: "PASS",
          public_content_verified: "FAIL", content_fidelity_warning: "BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK" });
        expect(db.pragma("foreign_key_check")).toEqual([]);
      } finally { db.close(); }
    }
  });
});
