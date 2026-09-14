import { describe, expect, it, vi } from "vitest";
import { ensureXhsIdentityPage, type IdentityPageEnsureContext, type IdentityPageEnsurePage } from "./ensure-identity-page";

function page(url: string, context: object): IdentityPageEnsurePage {
  return {
    context: () => context,
    isClosed: () => false,
    url: () => url,
    goto: vi.fn(async (nextUrl: string) => { url = nextUrl; })
  };
}

function contextWith(pages: IdentityPageEnsurePage[]): IdentityPageEnsureContext {
  const runtime = context as Record<string, unknown>;
  runtime.pages = () => pages;
  runtime.newPage = vi.fn(async () => {
    const created = page("about:blank", context);
    pages.push(created);
    return created;
  });
  return runtime as unknown as IdentityPageEnsureContext;
}

let context: object;

describe("ensureXhsIdentityPage", () => {
  it("reuses an existing /new/home page", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const identity = page("https://creator.xiaohongshu.com/new/home", context);
    const runtime = contextWith([editor, identity]);

    await expect(ensureXhsIdentityPage({ context: runtime, editorPage: editor })).resolves.toMatchObject({
      status: "PASS", action: "REUSED", identityPage: identity, sameBrowserContext: true,
      identityPageUrl: "https://creator.xiaohongshu.com/new/home", editorPageUrl: "https://creator.xiaohongshu.com/publish/publish"
    });
    expect(identity.goto).not.toHaveBeenCalled();
    expect(runtime.newPage).not.toHaveBeenCalled();
  });

  it("navigates an about:blank page and leaves the editor URL unchanged", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const blank = page("about:blank", context);
    const runtime = contextWith([editor, blank]);

    await expect(ensureXhsIdentityPage({ context: runtime, editorPage: editor })).resolves.toMatchObject({
      status: "PASS", action: "NAVIGATED_EXISTING_BLANK", identityPage: blank, sameBrowserContext: true,
      identityPageUrl: "https://creator.xiaohongshu.com/new/home", editorPageUrl: "https://creator.xiaohongshu.com/publish/publish"
    });
    expect(blank.goto).toHaveBeenCalledWith("https://creator.xiaohongshu.com/new/home");
    expect(editor.goto).not.toHaveBeenCalled();
    expect(runtime.newPage).not.toHaveBeenCalled();
  });

  it("creates a new page when no safe blank page exists", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const runtime = contextWith([editor]);

    const result = await ensureXhsIdentityPage({ context: runtime, editorPage: editor });
    expect(result.status).toBe("PASS");
    expect(result.action).toBe("CREATED_NEW_PAGE");
    expect(result.sameBrowserContext).toBe(true);
    expect(runtime.newPage).toHaveBeenCalledTimes(1);
    expect(editor.url()).toBe("https://creator.xiaohongshu.com/publish/publish");
  });

  it("fails closed for a missing editor", async () => {
    context = {};
    const identity = page("https://creator.xiaohongshu.com/new/home", context);
    await expect(ensureXhsIdentityPage({ context: contextWith([identity]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "EDITOR_PAGE_NOT_FOUND" });
  });

  it("fails closed for ambiguous editors and identity pages", async () => {
    context = {};
    const editorA = page("https://creator.xiaohongshu.com/publish/publish", context);
    const editorB = page("https://creator.xiaohongshu.com/publish/publish", context);
    await expect(ensureXhsIdentityPage({ context: contextWith([editorA, editorB]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "EDITOR_PAGE_AMBIGUOUS" });

    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const identityA = page("https://creator.xiaohongshu.com/new/home", context);
    const identityB = page("https://creator.xiaohongshu.com/new/home", context);
    await expect(ensureXhsIdentityPage({ context: contextWith([editor, identityA, identityB]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_AMBIGUOUS" });
  });

  it("fails closed for wrong navigation URL and never navigates the editor", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const blank = page("about:blank", context);
    blank.goto = vi.fn(async () => undefined);
    await expect(ensureXhsIdentityPage({ context: contextWith([editor, blank]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_WRONG_ROUTE" });
    expect(editor.url()).toBe("https://creator.xiaohongshu.com/publish/publish");
    expect(editor.goto).not.toHaveBeenCalled();
  });

  it("fails closed when navigation throws", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const blank = page("about:blank", context);
    blank.goto = vi.fn(async () => { throw new Error("navigation failed"); });
    await expect(ensureXhsIdentityPage({ context: contextWith([editor, blank]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_NAVIGATION_FAILED" });
  });

  it("fails closed when a candidate belongs to another context", async () => {
    context = {};
    const editor = page("https://creator.xiaohongshu.com/publish/publish", context);
    const foreign = page("https://creator.xiaohongshu.com/new/home", {});
    await expect(ensureXhsIdentityPage({ context: contextWith([editor, foreign]) })).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_CONTEXT_MISMATCH" });
  });
});
