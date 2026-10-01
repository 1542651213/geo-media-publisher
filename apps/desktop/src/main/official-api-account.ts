import type { AppRepository } from "@publisher/db";
import { CredentialDecryptError, type CredentialStore } from "@publisher/security";
import { KANGYI_SITE_CONFIG, OfficialApiAdapter, assertOfficialApiCapabilities, officialApiCredentialFields, officialApiCredentialRef,
  parseOfficialApiCredential, readOfficialApiCredential, type OfficialApiCredential, type WebsiteEnvironment } from "../../../../packages/adapters/official-api/src";
import type { OfficialApiAccountView } from "../shared/official-api";

interface ConnectionDependencies { repository: AppRepository; credentials: CredentialStore; verify?: (config: OfficialApiCredential) => Promise<unknown>;
  assertReconfiguration?: (accountId: string, config: OfficialApiCredential) => void;
  assertBeforePersist?: () => void; bindAccount?: (accountId: string) => void }

export function officialApiAccountView(repository: AppRepository, credentials: CredentialStore, accountId: string): OfficialApiAccountView {
  const account = repository.getAccountById(accountId, "website");
  if (!account || account.archivedAt) throw new Error("WEBSITE_ACCOUNT_NOT_FOUND");
  try {
    const config = readOfficialApiCredential(credentials, accountId);
    return { accountId, configured: true, connectionMode: "OfficialAPI", status: "UNVERIFIED", siteId: config.siteId,
      environment: config.environment, baseUrl: config.origin, keyId: config.keyId, writesEnabled: false, contentTypes: [],
      apiVersion: null, lastVerifiedAt: account.loginStatus === "logged_in" && account.authorizationStatus === "Authorized" && account.enabled ? account.lastVerifiedAt ?? null : null };
  } catch (error) {
    // The saved public scope is routing metadata, never evidence of a working credential.
    const environment = account.externalAccountId === "kangyi:staging" ? "staging" : account.externalAccountId === "kangyi:production" ? "production" : null;
    return { accountId, configured: false, connectionMode: "OfficialAPI", status: error instanceof CredentialDecryptError ? "DECRYPT_FAILED" : "MISSING",
      siteId: environment ? "kangyi" : null, environment, baseUrl: environment ? KANGYI_SITE_CONFIG.origins[environment] : null,
      keyId: null, writesEnabled: false, contentTypes: [], apiVersion: null, lastVerifiedAt: null };
  }
}

export async function importOfficialApiCredential(deps: ConnectionDependencies, raw: string, environment: WebsiteEnvironment, accountId?: string): Promise<OfficialApiAccountView> {
  const config = parseOfficialApiCredential(raw, environment);
  const { repository, credentials } = deps;
  const assertSelectedAccountScope = () => {
    if (!accountId) return;
    const selected = repository.getAccountById(accountId, "website");
    if (!selected || selected.archivedAt) throw new Error("WEBSITE_ACCOUNT_NOT_FOUND");
    const view = officialApiAccountView(repository, credentials, accountId);
    if ((selected.externalAccountId && selected.externalAccountId !== `${config.siteId}:${environment}`)
      || (view.configured && view.environment !== environment)) throw new Error("WEBSITE_ACCOUNT_SCOPE_IMMUTABLE");
    if (view.configured) deps.assertReconfiguration?.(accountId, config);
  };
  assertSelectedAccountScope();
  const assertUniqueScope = () => {
    const conflict = repository.listAccounts({ includeArchived: true }).some(account => account.platformKey === "website" && account.id !== accountId
      && (account.externalAccountId === `${config.siteId}:${environment}`
        || (!account.archivedAt && officialApiAccountView(repository, credentials, account.id).environment === environment)));
    if (conflict) throw new Error(accountId ? "WEBSITE_ACCOUNT_SCOPE_ALREADY_BOUND" : "WEBSITE_ACCOUNT_SELECTION_REQUIRED");
  };
  // Reconfiguration never guesses another account or creates a duplicate behind the Owner's back.
  assertUniqueScope();
  if (!credentials.setMany) throw new Error("WEBSITE_ATOMIC_CREDENTIAL_STORAGE_REQUIRED");
  const remote = assertOfficialApiCapabilities(config, await (deps.verify ?? (value => new OfficialApiAdapter(credentials).inspect(value)))(config));
  deps.assertBeforePersist?.();
  assertSelectedAccountScope();
  // Verification yielded; re-check against accounts created by any other completed request.
  assertUniqueScope();
  const name = `康一官网 · ${environment} · OfficialAPI`;
  const account = repository.configureOfficialApiAccount({ accountId, platformKey: "website", name, externalAccountId: `${config.siteId}:${environment}` }, id => {
    const bundle = Object.fromEntries(officialApiCredentialFields.map(field => [officialApiCredentialRef(id, field.key), config[field.key as keyof OfficialApiCredential]]));
    credentials.setMany!(bundle);
  });
  deps.bindAccount?.(account.id);
  return { ...officialApiAccountView(repository, credentials, account.id), status: remote.writesEnabled ? "CONNECTED" : "READ_ONLY",
    writesEnabled: remote.writesEnabled, apiVersion: remote.protocolVersion, contentTypes: remote.contentKinds, lastVerifiedAt: account.lastVerifiedAt ?? null };
}

export async function verifyOfficialApiConnection(deps: ConnectionDependencies, accountId: string): Promise<OfficialApiAccountView> {
  const { repository, credentials } = deps;
  const before = repository.getAccountById(accountId, "website");
  const view = officialApiAccountView(repository, credentials, accountId);
  if (!before || !view.configured) throw new Error("WEBSITE_CREDENTIAL_MISSING_OR_DECRYPT_FAILED");
  const config = readOfficialApiCredential(credentials, accountId);
  const assertUnchanged = () => {
    const current = repository.getAccountById(accountId, "website");
    if (!current || current.archivedAt || current.enabled !== before.enabled || current.loginStatus !== before.loginStatus
      || current.authorizationStatus !== before.authorizationStatus || current.externalAccountId !== before.externalAccountId
      || current.lastVerifiedAt !== before.lastVerifiedAt) throw new Error("WEBSITE_ACCOUNT_CHANGED_DURING_VERIFICATION");
    const latest = readOfficialApiCredential(credentials, accountId);
    if (officialApiCredentialFields.some(field => latest[field.key as keyof OfficialApiCredential] !== config[field.key as keyof OfficialApiCredential]))
      throw new Error("WEBSITE_CREDENTIAL_CHANGED_DURING_VERIFICATION");
  };
  let remote;
  try { remote = assertOfficialApiCapabilities(config, await (deps.verify ?? (value => new OfficialApiAdapter(credentials).inspect(value)))(config)); }
  catch (error) {
    // Never override a disconnect, credential rotation or other completed request with an older result.
    assertUnchanged();
    repository.updateAccount(accountId, { loginStatus: "unknown", pausedReason: "官网 API 连接未通过当前验证" });
    throw error;
  }
  assertUnchanged();
  const timestamp = new Date().toISOString();
  repository.syncOfficialApiAccount({ accountId, platformKey: "website", accountName: `康一官网 · ${config.environment} · OfficialAPI`,
    externalAccountId: `${remote.siteId}:${remote.environment}`, lastVerifiedAt: timestamp });
  return { ...view, status: remote.writesEnabled ? "CONNECTED" : "READ_ONLY", writesEnabled: remote.writesEnabled,
    contentTypes: remote.contentKinds, apiVersion: remote.protocolVersion, lastVerifiedAt: timestamp };
}
