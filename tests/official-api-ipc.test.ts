import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import type { IpcDependencies } from "../apps/desktop/src/main/ipc";
import type { CredentialStore } from "@publisher/security";

const handlers = vi.hoisted(() => new Map<string, (_event: unknown, payload: unknown) => Promise<unknown>>());
const pickFile = vi.hoisted(() => vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })));
vi.mock("electron", () => ({ ipcMain: { removeHandler: (channel: string) => handlers.delete(channel),
  handle: (channel: string, handler: (_event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler) },
  app: { getPath: () => "" }, dialog: { showOpenDialog: pickFile }, shell: {} }));
import { registerIpc } from "../apps/desktop/src/main/ipc";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); pickFile.mockClear(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "official-api-ipc-")); roots.push(root);
  const { db, repository } = openDatabase(join(root, "publisher.db"), join(process.cwd(), "packages/db/migrations")); databases.push(db);
  repository.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv"));
  const values = new Map<string, string>();
  const credentials: CredentialStore = { get: key => values.get(key) ?? null, has: key => values.has(key),
    set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); } };
  registerIpc({ repository, credentials, aiCredentials: credentials, publisher: {}, scheduler: {}, registry: {},
    resolveAccountSecrets: () => ({}), dataDirectory: root, coverDir: root, appLogPath: "", databasePath: join(root, "publisher.db"),
    logger: { info: () => {}, warn: () => {}, error: () => {} } } as unknown as IpcDependencies);
  const invoke = (channel: string, payload: unknown) => { const handler = handlers.get(channel); if (!handler) throw Error("IPC_NOT_FOUND"); return handler({}, payload); };
  return { repository, values, invoke };
}

describe("OfficialAPI Renderer request-only IPC", () => {
  it("rejects Renderer-supplied credentials or arbitrary authorization state before opening a file", async () => {
    const { repository, invoke, values } = fixture();
    for (const extra of [{ secret: "renderer-value" }, { origin: "https://untrusted.example" }, { status: "FinalApproved" }, { filePath: "untrusted.json" }])
      await expect(invoke("website:import-credentials", { environment: "staging", ...extra })).rejects.toThrow();
    expect(pickFile).not.toHaveBeenCalled();
    expect(repository.listAccounts()).toHaveLength(0);
    expect(values.size).toBe(0);
  });
  it("uses a native Main file picker and cancellation performs no persistence", async () => {
    const { repository, invoke, values } = fixture();
    await expect(invoke("website:import-credentials", { environment: "staging" })).rejects.toThrow("IMPORT_CANCELLED");
    expect(pickFile).toHaveBeenCalledOnce();
    expect(repository.listAccounts()).toHaveLength(0);
    expect(values.size).toBe(0);
  });
  it("does not disclose the selected local credential path when a file cannot be read", async () => {
    const { invoke, repository, values } = fixture();
    pickFile.mockResolvedValueOnce({ canceled: false, filePaths: [join(tmpdir(), "missing-owner-private-directory", "private-credential.json")] });
    await expect(invoke("website:import-credentials", { environment: "staging" })).rejects.toThrow("WEBSITE_CREDENTIAL_FILE_INVALID");
    expect(repository.listAccounts()).toHaveLength(0);
    expect(values.size).toBe(0);
  });
  it("prevents the generic credential API from bypassing the Main import contract", async () => {
    const { repository, invoke, values } = fixture();
    const account = repository.createAccount({ platformKey: "website", name: "fixture" });
    await expect(invoke("accounts:set-credentials", { accountId: account.id, platformKey: "website", values: { secret: "renderer-value" } })).rejects.toThrow("Main");
    expect(values.size).toBe(0);
    await expect(invoke("website:list-connections", {})).resolves.toEqual([expect.objectContaining({ accountId: account.id, configured: false, status: "MISSING" })]);
    await expect(invoke("website:verify-connection", { accountId: account.id, writesEnabled: true })).rejects.toThrow();
    await expect(invoke("website:verify-connection", { accountId: account.id })).rejects.toThrow("MISSING_OR_DECRYPT_FAILED");
    for (const channel of ["website:set-secret", "website:set-status", "website:grant", "website:publish", "website:purge"])
      expect(handlers.has(channel)).toBe(false);
  });
  it("rejects arbitrary remote identities and purge grants on recovery and maintenance IPC", async () => {
    const { invoke } = fixture();
    for (const extra of [{ contentId: "foreign-content" }, { remoteJobId: "foreign-job" }, { acceptanceRunId: "renderer-grant" }, { explicitPermission: true }]) {
      await expect(invoke("website:maintain", { jobId: "own-job", operation: "purge", ...extra })).rejects.toThrow();
      await expect(invoke("website:recover", { jobId: "own-job", ...extra })).rejects.toThrow();
    }
    await expect(invoke("website:availability", {})).resolves.toEqual({ ordinaryEnabled: false, candidateSelections: [] });
    await expect(invoke("website:maintain", { jobId: "own-job", operation: "purge" })).rejects.toThrow("CONTROLLER_UNAVAILABLE");
  });
});
