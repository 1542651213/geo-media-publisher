/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { app, safeStorage } = require("electron");
const { readFileSync, statSync } = require("node:fs");

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const credentialPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/credentials.enc";
const credentialKey = "session:xiaohongshu:54b390ac-d81e-440a-baeb-d00f9f346cc3";

app.setName("codex-media-publisher-session-diagnostic");
app.setPath("userData", userDataPath);
app.on("ready", () => {
  try {
    const file = statSync(credentialPath);
    const records = JSON.parse(readFileSync(credentialPath, "utf8"));
    const encoded = records[credentialKey];
    if (typeof encoded !== "string") throw new Error("SESSION_RECORD_MISSING");
    const state = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, "base64")));
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const origins = Array.isArray(state.origins) ? state.origins : [];
    const indexedDbEntries = origins.flatMap((origin) => Array.isArray(origin.indexedDB) ? origin.indexedDB : []);
    const localStorage = origins.map((origin) => ({ origin: origin.origin, keyCount: Array.isArray(origin.localStorage) ? origin.localStorage.length : 0, keyNames: (Array.isArray(origin.localStorage) ? origin.localStorage : []).map((entry) => entry.name).filter((value) => typeof value === "string").sort() }));
    process.stdout.write(`${JSON.stringify({ credentialKey, credentialFile: credentialPath, credentialFileBytes: file.size, credentialFileLastWrite: file.mtime.toISOString(), encryptedRecordBytes: Buffer.byteLength(encoded, "utf8"), safeStorageAvailable: safeStorage.isEncryptionAvailable(), storageStateKeys: Object.keys(state).sort(), cookieCount: cookies.length, cookieDomains: [...new Set(cookies.map((cookie) => cookie.domain).filter((value) => typeof value === "string"))].sort(), cookieNameCount: new Set(cookies.map((cookie) => cookie.name).filter((value) => typeof value === "string")).size, cookieExpiryPresenceCount: cookies.filter((cookie) => typeof cookie.expires === "number" && cookie.expires >= 0).length, originCount: origins.length, originNames: origins.map((origin) => origin.origin).filter((value) => typeof value === "string").sort(), localStorage, indexedDBEntryCount: indexedDbEntries.length, indexedDBDatabaseNames: indexedDbEntries.map((database) => database.name).filter((value) => typeof value === "string").sort()})}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    app.exit(1);
  }
});
