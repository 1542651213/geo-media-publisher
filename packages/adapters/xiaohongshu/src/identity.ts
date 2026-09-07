import type { Locator, Page } from "playwright-core";

const ACCOUNT_LABEL_SELECTOR = "text=小红书账号";
const PROFILE_LINK_SELECTOR = "a[href]";
const MAX_MATCHES = 10;
const MAX_TEXT_LENGTH = 300;
const MAX_ANCESTOR_DEPTH = 3;
const DATA_ATTRIBUTE_ALLOWLIST = ["data-testid", "data-id", "data-user-id", "data-account-id", "data-creator-id"] as const;

export type XiaohongshuCreatorIdentityCandidateSource = "CREATOR_HOME_ACCOUNT_LABEL" | "CREATOR_PROFILE_LINK";

export interface XiaohongshuCreatorIdentityCandidate {
  source: XiaohongshuCreatorIdentityCandidateSource;
  rawValue: string;
  normalizedCreatorId: string;
  semanticAnchor: "xiaohongshu-account-id-label" | "xiaohongshu-profile-link";
}

export interface XiaohongshuIdentityDomAncestorDiagnostic {
  depth: number;
  tagName: string | null;
  role: string | null;
  className: string | null;
  textContent: string;
  href: string | null;
  dataAttributes: Record<string, string>;
}

export interface XiaohongshuIdentityDomDiagnosticMatch {
  index: number;
  tagName: string | null;
  role: string | null;
  className: string | null;
  textContent: string;
  href: string | null;
  dataAttributes: Record<string, string>;
  visible: boolean;
  ancestors: XiaohongshuIdentityDomAncestorDiagnostic[];
}

export interface XiaohongshuIdentityDomDiagnostic {
  selector: typeof ACCOUNT_LABEL_SELECTOR;
  matchCount: number;
  matches: XiaohongshuIdentityDomDiagnosticMatch[];
}

export type XiaohongshuCreatorIdentityResolution =
  | { status: "PASS"; normalizedCreatorId: string; candidates: XiaohongshuCreatorIdentityCandidate[]; failureCode: null }
  | { status: "NOT_VERIFIED"; normalizedCreatorId: null; candidates: XiaohongshuCreatorIdentityCandidate[]; failureCode: "CREATOR_ID_NOT_FOUND" }
  | { status: "AMBIGUOUS"; normalizedCreatorId: null; candidates: XiaohongshuCreatorIdentityCandidate[]; failureCode: "AMBIGUOUS_IDENTITY" };

export type XiaohongshuBoundedCreatorIdentityRead = XiaohongshuCreatorIdentityResolution & {
  observedCreatorIdRaw: string | null;
  displayName: string | null;
  profileUrl: string | null;
  diagnostic: XiaohongshuIdentityDomDiagnostic;
};

/** Context-bound identity proofs deliberately outlive the identity source Page. */
export const XIAOHONGSHU_PAGE_SCOPED_IDENTITY_PROOF_TTL_MS = 300_000;

export interface XiaohongshuPageScopedIdentityProof {
  browserSessionId: string;
  contextId: string;
  pageId: string;
  pageOrigin: "https://creator.xiaohongshu.com";
  pagePathname: string;
  creatorId: string;
  verifiedAt: string;
  expiresAt: string;
}

export type XiaohongshuPageScopedIdentityVerification =
  | { status: "PASS"; failureCode: null; proof: XiaohongshuPageScopedIdentityProof }
  | { status: "FAIL"; failureCode: string; proof: null };

export interface XiaohongshuPageIdentityScope {
  browserSessionId: string;
  contextId: string;
  pageId: string;
}

export function isXiaohongshuIdentitySourcePath(pathname: string): boolean {
  return pathname === "/new/home"
    || /^\/(?:publish\/manage|content|note|notes)(?:[/?#]|$)/iu.test(pathname);
}

/**
 * Verify one already-owned Page using only the bounded DOM identity reader.
 * Page ownership and the scope metadata are supplied by the adapter's Main
 * process caller; this helper accepts no selectors, scripts, URLs, or Page IDs
 * from Renderer code.
 */
export async function verifyIdentityOnPage(page: Page, scope: XiaohongshuPageIdentityScope): Promise<XiaohongshuPageScopedIdentityVerification> {
  if (!scope.browserSessionId || !scope.contextId || !scope.pageId) return { status: "FAIL", failureCode: "IDENTITY_SCOPE_METADATA_MISSING", proof: null };

  let pageUrl: string;
  try {
    if (page.isClosed()) return { status: "FAIL", failureCode: "IDENTITY_PAGE_CLOSED", proof: null };
    pageUrl = page.url();
  } catch {
    return { status: "FAIL", failureCode: "IDENTITY_PAGE_UNAVAILABLE", proof: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { status: "FAIL", failureCode: "IDENTITY_PAGE_URL_UNAVAILABLE", proof: null };
  }
  if (parsed.origin !== "https://creator.xiaohongshu.com") return { status: "FAIL", failureCode: "IDENTITY_PAGE_ORIGIN_NOT_ALLOWED", proof: null };
  if (parsed.pathname === "/publish/publish") return { status: "FAIL", failureCode: "PUBLISH_EDITOR_CANNOT_BE_IDENTITY_SOURCE", proof: null };
  if (!isXiaohongshuIdentitySourcePath(parsed.pathname)) return { status: "FAIL", failureCode: "IDENTITY_PAGE_ROUTE_NOT_ALLOWED", proof: null };

  const identity = await readXiaohongshuCreatorIdentity(page);
  if (identity.status !== "PASS" || !identity.normalizedCreatorId) {
    return { status: "FAIL", failureCode: identity.failureCode ?? "CREATOR_ID_NOT_FOUND", proof: null };
  }

  const verifiedAt = new Date();
  return {
    status: "PASS",
    failureCode: null,
    proof: {
      browserSessionId: scope.browserSessionId,
      contextId: scope.contextId,
      pageId: scope.pageId,
      pageOrigin: "https://creator.xiaohongshu.com",
      pagePathname: parsed.pathname,
      creatorId: identity.normalizedCreatorId,
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: new Date(verifiedAt.getTime() + XIAOHONGSHU_PAGE_SCOPED_IDENTITY_PROOF_TTL_MS).toISOString()
    }
  };
}

function compact(value: string): string {
  return value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
}

function boundedText(value: string): string {
  return compact(value).slice(0, MAX_TEXT_LENGTH);
}

/** Parse only the explicit semantic account label; never search arbitrary numbers. */
export function extractCreatorIdFromAccountLabel(text: string): string | null {
  const match = compact(text).match(/^小红书账号(?:\s*(?:ID|id))?\s*[:：]\s*([0-9]{3,64})$/u);
  return match?.[1] ?? null;
}

function normalizeCandidateValue(value: string): string | null {
  const normalized = compact(value);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u.test(normalized) ? normalized : null;
}

export function resolveCreatorIdentityCandidates(candidates: XiaohongshuCreatorIdentityCandidate[]): XiaohongshuCreatorIdentityResolution {
  const deduplicated = candidates.filter((candidate, index, all) => {
    const normalized = normalizeCandidateValue(candidate.normalizedCreatorId);
    return normalized !== null && all.findIndex((other) => other.normalizedCreatorId === candidate.normalizedCreatorId) === index;
  });
  const normalizedIds = [...new Set(deduplicated.map((candidate) => candidate.normalizedCreatorId))];
  if (normalizedIds.length === 0) return { status: "NOT_VERIFIED", normalizedCreatorId: null, candidates: [], failureCode: "CREATOR_ID_NOT_FOUND" };
  if (normalizedIds.length > 1) return { status: "AMBIGUOUS", normalizedCreatorId: null, candidates: deduplicated, failureCode: "AMBIGUOUS_IDENTITY" };
  const normalizedCreatorId = normalizedIds[0];
  if (!normalizedCreatorId) return { status: "NOT_VERIFIED", normalizedCreatorId: null, candidates: [], failureCode: "CREATOR_ID_NOT_FOUND" };
  return { status: "PASS", normalizedCreatorId, candidates: deduplicated, failureCode: null };
}

function locatorCount(locator: Locator): Promise<number> {
  const candidate = locator as unknown as { count?: () => Promise<number> };
  return typeof candidate.count === "function" ? candidate.count().catch(() => 0) : Promise.resolve(1);
}

function locatorAt(locator: Locator, index: number): Locator {
  const candidate = locator as unknown as { nth?: (position: number) => Locator; first?: () => Locator };
  if (typeof candidate.nth === "function") return candidate.nth(index);
  if (index === 0 && typeof candidate.first === "function") return candidate.first();
  return locator;
}

async function isVisible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? candidate.isVisible().catch(() => false) : true;
}

async function readAttribute(locator: Locator, name: string): Promise<string | null> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  if (typeof candidate.getAttribute !== "function") return null;
  const value = await candidate.getAttribute(name).catch(() => null);
  return value?.trim() || null;
}

async function readText(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (typeof candidate.innerText === "function") return boundedText(await candidate.innerText().catch(() => ""));
  if (typeof candidate.textContent === "function") return boundedText((await candidate.textContent().catch(() => null)) ?? "");
  return "";
}

async function readTagName(locator: Locator): Promise<string | null> {
  const candidate = locator as unknown as { evaluate?: (pageFunction: (element: Element) => string) => Promise<string> };
  if (typeof candidate.evaluate !== "function") return null;
  return (await candidate.evaluate((element) => element.tagName.toUpperCase()).catch(() => "")) || null;
}

async function readDataAttributes(locator: Locator): Promise<Record<string, string>> {
  const dataAttributes: Record<string, string> = {};
  for (const name of DATA_ATTRIBUTE_ALLOWLIST) {
    const value = await readAttribute(locator, name);
    if (value !== null) dataAttributes[name] = value;
  }
  return dataAttributes;
}

async function readLocatorMetadata(locator: Locator): Promise<{ tagName: string | null; role: string | null; className: string | null; textContent: string; href: string | null; dataAttributes: Record<string, string> }> {
  const [tagName, role, className, textContent, href, dataAttributes] = await Promise.all([
    readTagName(locator),
    readAttribute(locator, "role"),
    readAttribute(locator, "class"),
    readText(locator),
    readAttribute(locator, "href"),
    readDataAttributes(locator)
  ]);
  return { tagName, role, className, textContent, href, dataAttributes };
}

function parentLocator(locator: Locator): Locator | null {
  const candidate = locator as unknown as { locator?: (selector: string) => Locator };
  return typeof candidate.locator === "function" ? candidate.locator("xpath=..") : null;
}

function profileIdFromHref(href: string): string | null {
  try {
    const url = new URL(href, "https://creator.xiaohongshu.com/");
    if (!/^(?:www\.)?xiaohongshu\.com$|^creator\.xiaohongshu\.com$/iu.test(url.hostname)) return null;
    const match = url.pathname.match(/\/user\/profile\/([^/?#]+)/iu) ?? url.pathname.match(/\/user\/([^/?#]+)/iu);
    const value = match?.[1] ?? "";
    return normalizeCandidateValue(value);
  } catch {
    return null;
  }
}

function profileUrlFromHref(href: string): string | null {
  const id = profileIdFromHref(href);
  if (!id) return null;
  try {
    const url = new URL(href, "https://creator.xiaohongshu.com/");
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

async function readAccountLabelDiagnostics(page: Page): Promise<{ diagnostic: XiaohongshuIdentityDomDiagnostic; candidates: XiaohongshuCreatorIdentityCandidate[] }> {
  const diagnostic: XiaohongshuIdentityDomDiagnostic = { selector: ACCOUNT_LABEL_SELECTOR, matchCount: 0, matches: [] };
  const candidates: XiaohongshuCreatorIdentityCandidate[] = [];
  let locator: Locator;
  try {
    locator = page.locator(ACCOUNT_LABEL_SELECTOR);
  } catch {
    return { diagnostic, candidates };
  }
  const count = Math.min(MAX_MATCHES, await locatorCount(locator));
  diagnostic.matchCount = count;
  for (let index = 0; index < count; index += 1) {
    const matchLocator = locatorAt(locator, index);
    const visible = await isVisible(matchLocator);
    const metadata = await readLocatorMetadata(matchLocator);
    const ancestors: XiaohongshuIdentityDomAncestorDiagnostic[] = [];
    let current = matchLocator;
    for (let depth = 1; depth <= MAX_ANCESTOR_DEPTH; depth += 1) {
      const parent = parentLocator(current);
      if (!parent) break;
      const parentMetadata = await readLocatorMetadata(parent);
      ancestors.push({ depth, ...parentMetadata });
      const parsed = extractCreatorIdFromAccountLabel(parentMetadata.textContent);
      if (visible && parsed) candidates.push({ source: "CREATOR_HOME_ACCOUNT_LABEL", rawValue: parsed, normalizedCreatorId: parsed, semanticAnchor: "xiaohongshu-account-id-label" });
      current = parent;
    }
    const parsed = extractCreatorIdFromAccountLabel(metadata.textContent);
    if (visible && parsed) candidates.push({ source: "CREATOR_HOME_ACCOUNT_LABEL", rawValue: parsed, normalizedCreatorId: parsed, semanticAnchor: "xiaohongshu-account-id-label" });
    diagnostic.matches.push({ index, ...metadata, visible, ancestors });
  }
  return { diagnostic, candidates };
}

async function readProfileLinkCandidates(page: Page): Promise<{ candidates: XiaohongshuCreatorIdentityCandidate[]; profileUrl: string | null; displayName: string | null }> {
  const candidates: XiaohongshuCreatorIdentityCandidate[] = [];
  let locator: Locator;
  try {
    locator = page.locator(PROFILE_LINK_SELECTOR);
  } catch {
    return { candidates, profileUrl: null, displayName: null };
  }
  const count = Math.min(MAX_MATCHES, await locatorCount(locator));
  let profileUrl: string | null = null;
  let displayName: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const link = locatorAt(locator, index);
    if (!(await isVisible(link))) continue;
    const href = await readAttribute(link, "href");
    if (!href) continue;
    const id = profileIdFromHref(href);
    if (!id) continue;
    candidates.push({ source: "CREATOR_PROFILE_LINK", rawValue: id, normalizedCreatorId: id, semanticAnchor: "xiaohongshu-profile-link" });
    profileUrl ??= profileUrlFromHref(href);
    const text = await readText(link);
    displayName ??= text || null;
  }
  return { candidates, profileUrl, displayName };
}

export async function readXiaohongshuCreatorIdentity(page: Page): Promise<XiaohongshuBoundedCreatorIdentityRead> {
  const label = await readAccountLabelDiagnostics(page);
  const profile = await readProfileLinkCandidates(page);
  const resolution = resolveCreatorIdentityCandidates([...label.candidates, ...profile.candidates]);
  return {
    ...resolution,
    observedCreatorIdRaw: resolution.status === "PASS" ? resolution.candidates[0]?.rawValue ?? null : null,
    displayName: profile.displayName,
    profileUrl: profile.profileUrl,
    diagnostic: label.diagnostic
  };
}
