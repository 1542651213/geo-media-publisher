// Supplemental cross-process SQLite boundary race. No Electron/app startup.
import { request } from "node:http";
import { join } from "node:path";
import { openDatabase } from "../../packages/db/src/index";
const [databasePath, intentId, endpoint] = process.argv.slice(2);
if (!databasePath || !intentId || !endpoint || !endpoint.startsWith("http://127.0.0.1:")) throw new Error("Isolated arguments required");
const opened = openDatabase(databasePath, join(process.cwd(), "packages/db/migrations"));
const timeout = setTimeout(() => { opened.db.close(); process.exitCode = 2; process.disconnect?.(); }, 10_000);
process.once("message", async () => {
  let claimed = false; let directHttpCalls = 0; let error: string | null = null;
  try {
    opened.repository.claimSubmissionDispatch(intentId); claimed = true;
    directHttpCalls++;
    await new Promise<void>((resolve, reject) => {
      const req = request(endpoint, { method: "POST" }, (res) => { res.resume(); res.on("end", resolve); });
      req.on("error", reject); req.end(JSON.stringify({ intentId, workerPid: process.pid }));
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    if (claimed) opened.repository.markSubmissionIntentUncertain(intentId, "MOCK_RESPONSE_LOST");
  } finally {
    console.log(JSON.stringify({ pid: process.pid, claimed, directHttpCalls, error, argv: process.argv, cwd: process.cwd(), abi: process.versions.modules, executable: process.execPath, databasePath }));
    opened.db.close(); clearTimeout(timeout); process.disconnect?.();
  }
});
process.send?.("ready");
