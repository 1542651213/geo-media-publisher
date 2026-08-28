import { describe, expect, it } from "vitest";
import { classifyXhsNavigationEvents, sanitizeXhsDiagnosticUrl, type XhsNavigationEvent } from "./navigation-diagnostics";

describe("Xiaohongshu navigation diagnostics", () => {
  it("sanitizes query strings and fragments from recorded URLs", () => {
    expect(sanitizeXhsDiagnosticUrl("https://creator.xiaohongshu.com/login?token=secret#challenge")).toBe("https://creator.xiaohongshu.com/login");
    expect(sanitizeXhsDiagnosticUrl("not a url")).toBeNull();
  });

  it("classifies a server HTTP redirect to login", () => {
    const events: XhsNavigationEvent[] = [
      { kind: "response", url: "https://creator.xiaohongshu.com/new/home", status: 302, isDocument: true, location: "https://creator.xiaohongshu.com/login?ticket=secret" },
      { kind: "navigation", url: "https://creator.xiaohongshu.com/login?ticket=secret" }
    ];
    const result = classifyXhsNavigationEvents(events);
    expect(result.classification).toBe("SERVER_HTTP_REDIRECT");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("distinguishes auth API rejection followed by a client redirect", () => {
    const events: XhsNavigationEvent[] = [
      { kind: "response", url: "https://creator.xiaohongshu.com/api/user/session", status: 401, isDocument: false },
      { kind: "response", url: "https://creator.xiaohongshu.com/new/home", status: 200, isDocument: true },
      { kind: "navigation", url: "https://creator.xiaohongshu.com/login" }
    ];
    expect(classifyXhsNavigationEvents(events).classification).toBe("AUTH_API_REJECTION_THEN_CLIENT_REDIRECT");
  });
});
