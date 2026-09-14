const XHS_IDENTITY_PAGE_URL = "https://creator.xiaohongshu.com/new/home" as const;
const XHS_EDITOR_PATH = "/publish/publish" as const;

export interface IdentityPageEnsurePage {
  context(): object;
  isClosed(): boolean;
  url(): string;
  goto(url: string): Promise<unknown>;
}

export interface IdentityPageEnsureContext {
  pages(): readonly IdentityPageEnsurePage[];
  newPage(): Promise<IdentityPageEnsurePage>;
}

export type IdentityPageEnsureAction = "REUSED" | "NAVIGATED_EXISTING_BLANK" | "CREATED_NEW_PAGE";

export interface IdentityPageEnsureResult {
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  action: IdentityPageEnsureAction | null;
  identityPage: IdentityPageEnsurePage | null;
  identityPageUrl: string | null;
  editorPage: IdentityPageEnsurePage | null;
  editorPageUrl: string | null;
  sameBrowserContext: boolean;
}

function blocked(failureCode: string, editorPage: IdentityPageEnsurePage | null = null, editorPageUrl: string | null = null): IdentityPageEnsureResult {
  return { status: "BLOCKED", failureCode, action: null, identityPage: null, identityPageUrl: null, editorPage, editorPageUrl, sameBrowserContext: false };
}

function routeOf(page: IdentityPageEnsurePage): { origin: string; pathname: string } | null {
  try {
    const parsed = new URL(page.url());
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return null;
  }
}

function isOpen(page: IdentityPageEnsurePage): boolean {
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

export async function ensureXhsIdentityPage(input: { context: IdentityPageEnsureContext; editorPage?: IdentityPageEnsurePage }): Promise<IdentityPageEnsureResult> {
  const { context } = input;
  let pages: readonly IdentityPageEnsurePage[];
  try {
    pages = context.pages();
  } catch {
    return blocked("CONTEXT_PAGES_UNAVAILABLE");
  }

  const openPages = pages.filter(isOpen);
  const editors = openPages.filter((page) => routeOf(page)?.origin === "https://creator.xiaohongshu.com" && routeOf(page)?.pathname === XHS_EDITOR_PATH);
  if (editors.length === 0) return blocked("EDITOR_PAGE_NOT_FOUND");
  if (editors.length !== 1) return blocked("EDITOR_PAGE_AMBIGUOUS");
  const editorPage = editors[0]!;
  if (input.editorPage && input.editorPage !== editorPage) return blocked("EDITOR_PAGE_MISMATCH");
  const editorPageUrl = editorPage.url();
  if (editorPage.context() !== context) return blocked("EDITOR_PAGE_CONTEXT_MISMATCH", editorPage, editorPageUrl);

  const identityPages = openPages.filter((page) => routeOf(page)?.origin === "https://creator.xiaohongshu.com" && routeOf(page)?.pathname === "/new/home");
  if (identityPages.length > 1) return blocked("IDENTITY_PAGE_AMBIGUOUS", editorPage, editorPageUrl);
  if (identityPages.length === 1) {
    const identityPage = identityPages[0]!;
    if (identityPage.context() !== context) return blocked("IDENTITY_PAGE_CONTEXT_MISMATCH", editorPage, editorPageUrl);
    return { status: "PASS", failureCode: null, action: "REUSED", identityPage, identityPageUrl: identityPage.url(), editorPage, editorPageUrl, sameBrowserContext: true };
  }

  const blanks = openPages.filter((page) => page.url() === "about:blank");
  if (blanks.length > 1) return blocked("IDENTITY_BLANK_PAGE_AMBIGUOUS", editorPage, editorPageUrl);
  let identityPage: IdentityPageEnsurePage;
  let action: IdentityPageEnsureAction;
  if (blanks.length === 1) {
    identityPage = blanks[0]!;
    action = "NAVIGATED_EXISTING_BLANK";
  } else {
    try {
      identityPage = await context.newPage();
    } catch {
      return blocked("IDENTITY_PAGE_CREATE_FAILED", editorPage, editorPageUrl);
    }
    action = "CREATED_NEW_PAGE";
  }
  if (identityPage.context() !== context) return blocked("IDENTITY_PAGE_CONTEXT_MISMATCH", editorPage, editorPageUrl);
  try {
    await identityPage.goto(XHS_IDENTITY_PAGE_URL);
  } catch {
    return blocked("IDENTITY_PAGE_NAVIGATION_FAILED", editorPage, editorPageUrl);
  }
  const identityRoute = routeOf(identityPage);
  if (identityRoute?.origin !== "https://creator.xiaohongshu.com" || identityRoute.pathname !== "/new/home") return blocked("IDENTITY_PAGE_WRONG_ROUTE", editorPage, editorPageUrl);
  if (!isOpen(editorPage) || editorPage.url() !== editorPageUrl || editorPage.context() !== context) return blocked("EDITOR_PAGE_CHANGED", editorPage, editorPageUrl);
  return { status: "PASS", failureCode: null, action, identityPage, identityPageUrl: identityPage.url(), editorPage, editorPageUrl, sameBrowserContext: true };
}

export { XHS_IDENTITY_PAGE_URL };
