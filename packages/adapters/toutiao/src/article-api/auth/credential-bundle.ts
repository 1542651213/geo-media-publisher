import { createHash } from "node:crypto";
import { canonicalSerialize, deepFreeze } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";
import type { SafeStorageCredentialStore } from "@publisher/security";
import type { ToutiaoCookie } from "./cookie-resolver";

export type ToutiaoCredentialState = "VALID" | "INVALID" | "UNKNOWN";
export type ToutiaoCredentialSource = "browser_session" | "manual_import" | "token_refresh";
export interface ToutiaoCredentialBundle {
  readonly accountId: string;
  readonly version: number;
  readonly loginGeneration: number;
  readonly capturedAt: string;
  readonly cookieMaterial: readonly ToutiaoCookie[];
  readonly sessionIdentity: string;
  readonly csrf: string | null;
  readonly antiToken: string | null;
  readonly msToken: string | null;
  readonly expiresAt: string | null;
  readonly validatedAt: string | null;
  readonly state: ToutiaoCredentialState;
  readonly source: ToutiaoCredentialSource;
}
export type ToutiaoCredentialMaterial = Pick<ToutiaoCredentialBundle, "cookieMaterial" | "sessionIdentity" | "csrf" | "antiToken" | "msToken" | "expiresAt" | "validatedAt" | "state" | "source">;
export type ToutiaoCredentialChange = "initial_login" | "login" | "logout" | "token_refresh";

export class ToutiaoCredentialBindingError extends Error {
  constructor(readonly code: "CREDENTIAL_BINDING_MISMATCH" | "CREDENTIAL_REPREFLIGHT_REQUIRED") { super(code); }
}

export function credentialFingerprint(bundle: ToutiaoCredentialBundle): string {
  const sortedCookies = bundle.cookieMaterial.map((cookie) => ({ name: cookie.name, value: cookie.value,
    domain: cookie.domain.toLowerCase().replace(/^\./u, ""), path: cookie.path || "/", hostOnly: cookie.hostOnly,
    secure: cookie.secure, expiresAt: cookie.expiresAt })).sort((a, b) => canonicalSerialize(a) < canonicalSerialize(b) ? -1 : canonicalSerialize(a) > canonicalSerialize(b) ? 1 : 0);
  return createHash("sha256").update(canonicalSerialize({ domain: "toutiao-credential-fingerprint-v1", accountId: bundle.accountId,
    sessionIdentity: bundle.sessionIdentity, cookieMaterial: sortedCookies, csrf: bundle.csrf, antiToken: bundle.antiToken, msToken: bundle.msToken })).digest("hex");
}

function bundleKey(accountId: string): string { return `toutiao:article-api:credential-bundle:${accountId}`; }

/** One encrypted store key holds the entire bundle; SQLite receives metadata only. */
export class ToutiaoCredentialBundleService {
  constructor(private readonly credentials: SafeStorageCredentialStore, private readonly repository: AppRepository) {}

  read(accountId: string): Readonly<ToutiaoCredentialBundle> | null {
    const account = this.repository.listAccounts().find((item) => item.id === accountId && item.platformKey === "toutiao");
    if (!account) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    const raw = this.credentials.get(bundleKey(accountId));
    const metadata = this.repository.getToutiaoCredentialMetadata(accountId);
    if (!raw && !metadata) return null;
    if (!raw || !metadata) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    let bundle: ToutiaoCredentialBundle;
    try { bundle = JSON.parse(raw) as ToutiaoCredentialBundle; }
    catch { throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH"); }
    let fingerprint: string;
    try { fingerprint = credentialFingerprint(bundle); }
    catch { throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH"); }
    if (bundle.accountId !== accountId || bundle.version !== metadata.bundleVersion || bundle.loginGeneration !== metadata.loginGeneration
      || bundle.state !== metadata.credentialState || bundle.validatedAt !== metadata.validatedAt || fingerprint !== metadata.credentialFingerprint) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    return deepFreeze(bundle);
  }

  update(accountId: string, material: ToutiaoCredentialMaterial, change: ToutiaoCredentialChange, capturedAt = new Date().toISOString()): Readonly<ToutiaoCredentialBundle> {
    const prior = this.read(accountId);
    if (!Array.isArray(material.cookieMaterial) || typeof material.sessionIdentity !== "string"
      || change !== "logout" && !material.sessionIdentity || material.cookieMaterial.some((cookie) => !cookie.name || !cookie.domain || /[\r\n]/u.test(cookie.value))
      || !Number.isFinite(Date.parse(capturedAt)) || material.expiresAt && !Number.isFinite(Date.parse(material.expiresAt))
      || material.validatedAt && !Number.isFinite(Date.parse(material.validatedAt))) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    if (change === "initial_login" && prior) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    if (change !== "initial_login" && !prior) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    if (change === "token_refresh" && material.sessionIdentity !== prior?.sessionIdentity) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    if (change === "logout" && (material.state !== "INVALID" || material.cookieMaterial.length || material.csrf || material.antiToken || material.msToken || material.validatedAt)) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    const next: ToutiaoCredentialBundle = { accountId, version: (prior?.version ?? 0) + 1,
      loginGeneration: (prior?.loginGeneration ?? 0) + (change === "token_refresh" ? 0 : 1), capturedAt,
      cookieMaterial: material.cookieMaterial.map((cookie) => ({ ...cookie })), sessionIdentity: material.sessionIdentity,
      csrf: material.csrf, antiToken: material.antiToken, msToken: material.msToken, expiresAt: material.expiresAt,
      validatedAt: material.validatedAt, state: material.state, source: material.source };
    const key = bundleKey(accountId);
    this.credentials.set(key, canonicalSerialize(next));
    try {
      this.repository.updateToutiaoCredentialMetadata({ accountId, bundleVersion: next.version, loginGeneration: next.loginGeneration,
        credentialState: next.state, credentialFingerprint: credentialFingerprint(next), validatedAt: next.validatedAt }, prior?.version ?? null);
    } catch (error) {
      try { if (prior) this.credentials.set(key, canonicalSerialize(prior)); else this.credentials.delete(key); }
      catch { /* A mismatched encrypted bundle and metadata always fail closed on read. */ }
      throw error;
    }
    return deepFreeze(next);
  }

  assertBound(accountId: string, expectedVersion: number, expectedLoginGeneration: number, stage: "pre_submit" | "signed_or_submitting"): Readonly<ToutiaoCredentialBundle> {
    const bundle = this.read(accountId);
    if (!bundle || bundle.state !== "VALID" || !bundle.validatedAt || bundle.expiresAt && Date.parse(bundle.expiresAt) <= Date.now()
      || bundle.loginGeneration !== expectedLoginGeneration) throw new ToutiaoCredentialBindingError("CREDENTIAL_BINDING_MISMATCH");
    if (bundle.version !== expectedVersion) throw new ToutiaoCredentialBindingError(stage === "pre_submit" ? "CREDENTIAL_REPREFLIGHT_REQUIRED" : "CREDENTIAL_BINDING_MISMATCH");
    return bundle;
  }
}
