import { appendFileSync, readFileSync } from "node:fs";

const tracePath = "C:/Users/Administrator/Desktop/codex_media_publisher_starter/scripts/read-zhihu-session-once.trace.log";
const trace = (message) => appendFileSync(tracePath, `${new Date().toISOString()} ${message}\n`);
trace("module_started");
const { app, safeStorage } = await import("electron");
trace("electron_imported");
app.setName("codex-media-publisher");
app.setPath("userData", "C:/Users/Administrator/AppData/Roaming/codex-media-publisher");

const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";
const accountId = "8f666025-1776-41d5-8295-3bab150f615c";
const key = `session:zhihu:${accountId}`;

async function main() {
  let exitCode = 0;
  try {
    trace("waiting_for_ready");
    await app.whenReady();
    trace(`encryption_available:${safeStorage.isEncryptionAvailable()}`);
    const values = JSON.parse(readFileSync(`${dataDirectory}/credentials.enc`, "utf8"));
    const encoded = values[key];
    if (typeof encoded !== "string") throw new Error("SESSION_RECORD_MISSING");
    const session = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    trace("decrypted");
    process.stdout.write(JSON.stringify({ session }));
  } catch (error) {
    trace(`error:${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
    process.stderr.write(error instanceof Error ? error.message : String(error));
  } finally {
    trace("cleanup");
    app.quit();
    setTimeout(() => process.exit(exitCode), 500).unref();
  }
}

void main();
