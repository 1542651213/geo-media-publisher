import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { BrowserSessionManager, type PlatformAdapter } from "@publisher/adapters-core";
import { SafeStorageCredentialStore } from "@publisher/security";
import { AccountSessionRehydrationCoordinator, type AccountSessionTarget } from "../apps/desktop/src/main/account-session-rehydration";

// Local fixture only. This proves real Browser/Context restore, not live-platform login.
const root = resolve("output/r115-g-execution-20261002", `browser-restore-${Date.now()}`); mkdirSync(root, { recursive: true });
const cipherKey = randomBytes(32);
const encryption = { isEncryptionAvailable: () => true, encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", cipherKey, iv); return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]); }, decryptString(value: Buffer) { const decipher = createDecipheriv("aes-256-gcm", cipherKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString("utf8"); } };
const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html"); const identity = /fixture_identity=([ab])/u.exec(req.headers.cookie ?? "")?.[1]; res.end(`<body><div id="identity">${identity ?? "logged-out"}</div></body>`); });
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address === "object"); const url = `http://127.0.0.1:${address.port}`;
const credentialsPath = join(root, "fixture-credentials.enc");
let blockedNetwork = 0;
const manager = () => new BrowserSessionManager(new SafeStorageCredentialStore(credentialsPath, encryption), { launchBrowser: async ({ headless }) => {
  const browser = await chromium.launch({ channel: "chrome", headless, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
  const createContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await createContext(options);
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      if (target.origin === url) return route.continue();
      blockedNetwork++; return route.abort("blockedbyclient");
    });
    return context;
  };
  return browser;
} });
const first = manager();
try {
  for (const accountId of ["a", "b"]) {
    const identity = { platformKey: "fixture", accountId }, session = await first.open(identity, { userActionId: "local-fixture", triggerSource: "CONNECT_ACCOUNT" }, "BACKGROUND");
    await session.context.addCookies([{ name: "fixture_identity", value: accountId, url }]); await session.page.goto(url); await first.save(identity, session.context);
  }
  await first.closeAll(); assert.equal(readFileSync(credentialsPath, "utf8").includes("fixture_identity"), false);
  const second = manager();
  try {
    const adapter = { manifest: { transport: "browser" }, checkLogin: async (ctx: { accountId: string }) => { const session = await second.restore({ platformKey: "fixture", accountId: ctx.accountId }); assert.ok(session); assert.equal(session.headless, true); await session.page.goto(url); return await session.page.locator("#identity").textContent() === "logged-out" ? "expired" : "logged_in"; }, getAccountProfile: async (ctx: { accountId: string }) => { const session = second.getActiveSession({ platformKey: "fixture", accountId: ctx.accountId }); assert.ok(session); return { accountId: await session.page.locator("#identity").textContent() }; } } as unknown as PlatformAdapter;
    const targets: AccountSessionTarget[] = ["a", "b"].map(accountId => ({ accountId, accountName: accountId, platformKey: "fixture", companyId: `company-${accountId}`, connectionMode: "BrowserAutomation", enabled: true, expectedRemoteIdentity: accountId, loginGeneration: 1 }));
    const coordinator = new AccountSessionRehydrationCoordinator({ registry: { tryGetForConnection: () => adapter }, browserSessions: second, resolveCompanyId: accountId => `company-${accountId}`, concurrency: 2 });
    const result = await coordinator.rehydrate(targets); assert.ok(result.every(row => row.state === "AUTHENTICATED" && row.identityMatched));
    assert.notEqual(second.getActiveSession({ platformKey: "fixture", accountId: "a" })?.context, second.getActiveSession({ platformKey: "fixture", accountId: "b" })?.context);
    const mismatch = await coordinator.refresh({ ...targets[0]!, expectedRemoteIdentity: "b" }); assert.equal(mismatch.state, "IDENTITY_MISMATCH");
    const missing = await coordinator.refresh({ ...targets[0]!, accountId: "missing", companyId: "company-missing" }); assert.equal(missing.state, "NEEDS_LOGIN");
    const summary = { blockedExternalRequests: blockedNetwork, kind: "LOCAL_BROWSER_SYNTHETIC_DOM_ONLY", status: "PASS", realBrowserContexts: 2, restartedManagers: 2, hiddenRestore: true, exactIdentity: true, accountAndCompanyIsolation: true, wrongIdentity: "IDENTITY_MISMATCH", missingSession: "NEEDS_LOGIN", encryptedFixtureSnapshot: true, livePlatformProbe: "NOT_RUN", realPlatformPublishCount: 0, newFinalSubmitCount: 0 };
    writeFileSync("output/r115-g-execution-20261002/browser-restore-smoke.json", JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
  } finally { await second.closeAll(); }
} finally { await first.closeAll(); await new Promise<void>(done => server.close(() => done())); }
