import { join } from "node:path";
import { app, safeStorage } from "electron";

const jobId = "1bf90421-fa31-4a1f-b5a0-6639e671392b";
const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";
const reconcileTimeoutMs = 90_000;

app.setName("codex-media-publisher");
app.setPath("userData", "C:/Users/Administrator/AppData/Roaming/codex-media-publisher");

async function main() {
  let opened;
  let registry;
  let exitCode = 0;
  try {
    await app.whenReady();
    const { openDatabase } = await import("../packages/db/src/index.ts");
    const { SafeStorageCredentialStore } = await import("../packages/security/src/index.ts");
    const { createFileLogger } = await import("../packages/logger/src/index.ts");
    const { PublisherService } = await import("../packages/publisher/src/index.ts");
    const { createRuntimeAdapterRegistry } = await import("../apps/desktop/src/main/adapter-registry.ts");
    const migrationsDirectory = join(process.cwd(), "packages", "db", "migrations");
    opened = openDatabase(join(dataDirectory, "publisher.db"), migrationsDirectory);
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    registry = createRuntimeAdapterRegistry(credentials, false, logger);
    const resolveSecrets = (accountId, platformKey) => {
      const adapter = registry.get(platformKey);
      const keys = [...new Set([...adapter.getCredentialSchema().map((field) => field.key), "oauthAccessToken"])]
      return Object.fromEntries(keys.map((key) => [key, credentials.get(`account:${accountId}:${platformKey}:${key}`) ?? ""]));
    };
    const publisher = new PublisherService(opened.repository, registry, logger, { resolveSecrets });
    const reconciliation = publisher.reconcileBrowserJob(jobId, {
      userActionId: `read-only-reconcile-${Date.now()}`,
      triggerSource: "CONTINUE_PENDING_ACTION"
    });
    const result = await Promise.race([
      reconciliation,
      new Promise((_, reject) => setTimeout(() => reject(new Error("RECONCILIATION_TIMEOUT")), reconcileTimeoutMs))
    ]);
    console.log(JSON.stringify({
      message: result.message,
      job: {
        id: result.job.id,
        status: result.job.status,
        externalId: result.job.externalId ?? null,
        externalUrl: result.job.externalUrl ?? null,
        lastErrorCode: result.job.lastErrorCode ?? null
      }
    }));
  } catch (error) {
    exitCode = 1;
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      code: typeof error === "object" && error && "code" in error ? error.code : null
    }));
  } finally {
    if (registry) {
      await Promise.allSettled(registry.list().filter((adapter) => typeof adapter.closeOwnedSessions === "function").map((adapter) => adapter.closeOwnedSessions()));
    }
    opened?.db.close();
    app.quit();
    setTimeout(() => process.exit(exitCode), 1_500).unref();
  }
}

void main();
