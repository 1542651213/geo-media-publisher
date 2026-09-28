import { credentialFingerprint, type ToutiaoCookie, type ToutiaoCredentialBundle,
  type ToutiaoCredentialMaterial, type ToutiaoCredentialBundleService } from "@publisher/adapters-toutiao/article-api";
import type { AppRepository } from "@publisher/db";

/** Evidence is assembled in Main from the account-owned BrowserContext only. Never send it to Renderer. */
export interface OwnedCreatorCredentialEvidence {
  readonly accountId: string;
  readonly creatorId: string;
  readonly remoteAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly runtimeActive: boolean;
  readonly contextOwnsPage: boolean;
  readonly cookies: readonly ToutiaoCookie[];
  readonly validatedAt: string;
}

export interface OwnedCreatorCredentialBinding {
  readonly accountId: string;
  readonly creatorId: string;
  readonly bundleVersion: number;
  readonly loginGeneration: number;
  readonly changed: boolean;
}

function reject(): never { throw new Error("TOUTIAO_OWNED_CREDENTIAL_BINDING_REJECTED"); }

export function synchronizeOwnedToutiaoCredential(
  repository: AppRepository,
  credentials: ToutiaoCredentialBundleService,
  evidence: OwnedCreatorCredentialEvidence,
  expectedCreatorId: string
): OwnedCreatorCredentialBinding {
  const account = repository.getAccountById(evidence.accountId, "toutiao");
  const authorization = repository.getAccountAuthorization(evidence.accountId, "toutiao");
  if (!account || account.archivedAt || !account.enabled || account.loginStatus !== "logged_in"
    || account.authorizationStatus !== "Authorized" || !account.browserSessionId
    || authorization?.status !== "Authorized" || !expectedCreatorId || !/^\d+$/u.test(expectedCreatorId)
    || evidence.creatorId !== expectedCreatorId || account.externalAccountId && account.externalAccountId !== expectedCreatorId
    || authorization.providerAccountId && authorization.providerAccountId !== expectedCreatorId
    || evidence.remoteAuthState !== "VALID" || !evidence.runtimeActive || !evidence.contextOwnsPage
    || !evidence.cookies.length || !Number.isFinite(Date.parse(evidence.validatedAt))) reject();

  // read() checks encrypted secret and SQLite metadata as a pair. Any crash gap fails closed.
  const prior = credentials.read(account.id);
  if (prior && (prior.sessionIdentity !== evidence.creatorId || prior.state !== "VALID")) reject();
  const material: ToutiaoCredentialMaterial = {
    cookieMaterial: evidence.cookies,
    sessionIdentity: evidence.creatorId,
    csrf: null,
    antiToken: null,
    msToken: null,
    expiresAt: null,
    validatedAt: evidence.validatedAt,
    state: "VALID",
    source: "browser_session"
  };
  const sameMaterial = prior && credentialFingerprint({ ...prior, ...material } as ToutiaoCredentialBundle)
    === credentialFingerprint(prior);
  const bundle = sameMaterial ? prior : credentials.update(account.id, material,
    prior ? "token_refresh" : "initial_login");
  if (!account.externalAccountId || authorization.providerAccountId !== expectedCreatorId) {
    repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "toutiao",
      browserSessionId: account.browserSessionId, externalAccountId: expectedCreatorId,
      lastVerifiedAt: evidence.validatedAt });
  }
  return { accountId: account.id, creatorId: evidence.creatorId, bundleVersion: bundle.version,
    loginGeneration: bundle.loginGeneration, changed: !sameMaterial };
}
