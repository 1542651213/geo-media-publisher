import type { Page } from "playwright-core";

export type XhsNavigationEvent =
  | { kind: "request"; url: string; method: string; resourceType: string; isDocument: boolean }
  | { kind: "response"; url: string; status: number; isDocument: boolean; location?: string | null }
  | { kind: "navigation"; url: string };

export type XhsRedirectClassification =
  | "SERVER_HTTP_REDIRECT"
  | "CLIENT_SIDE_REDIRECT"
  | "AUTH_API_REJECTION_THEN_CLIENT_REDIRECT"
  | "NO_LOGIN_REDIRECT"
  | "UNKNOWN";

export interface XhsNavigationClassification {
  classification: XhsRedirectClassification;
  finalUrl: string | null;
  loginUrl: string | null;
  serverRedirects: Array<{ url: string; status: number; location: string | null }>;
  authApiRejections: Array<{ url: string; status: number }>;
  frameNavigations: string[];
  safeEvents: XhsNavigationEvent[];
}

export function sanitizeXhsDiagnosticUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/iu.test(url.protocol)) return null;
    return `${url.origin}${url.pathname || "/"}`;
  } catch {
    return null;
  }
}

function isLoginUrl(value: string | null): boolean {
  return Boolean(value && /\/(?:login|signin|auth|passport)(?:\/|$)/iu.test(value));
}

function isAuthApiUrl(value: string): boolean {
  return /\/(?:api|auth|passport|session|user)(?:\/|$)/iu.test(value);
}

function safeEvent(event: XhsNavigationEvent): XhsNavigationEvent {
  if (event.kind === "request") return { ...event, url: sanitizeXhsDiagnosticUrl(event.url) ?? "invalid://url" };
  if (event.kind === "response") return { ...event, url: sanitizeXhsDiagnosticUrl(event.url) ?? "invalid://url", location: sanitizeXhsDiagnosticUrl(event.location) };
  return { ...event, url: sanitizeXhsDiagnosticUrl(event.url) ?? "invalid://url" };
}

export function classifyXhsNavigationEvents(events: XhsNavigationEvent[]): XhsNavigationClassification {
  const safeEvents = events.map(safeEvent);
  const responses = safeEvents.filter((event): event is Extract<XhsNavigationEvent, { kind: "response" }> => event.kind === "response");
  const navigations = safeEvents.filter((event): event is Extract<XhsNavigationEvent, { kind: "navigation" }> => event.kind === "navigation");
  const serverRedirects = responses
    .filter((event) => event.isDocument && event.status >= 300 && event.status < 400 && isLoginUrl(event.location ?? event.url))
    .map((event) => ({ url: event.url, status: event.status, location: event.location ?? null }));
  const authApiRejections = responses
    .filter((event) => !event.isDocument && (event.status === 401 || event.status === 403) && isAuthApiUrl(event.url))
    .map((event) => ({ url: event.url, status: event.status }));
  const frameNavigations = navigations.map((event) => event.url);
  const finalUrl = frameNavigations.at(-1) ?? null;
  const loginUrl = frameNavigations.find((url) => isLoginUrl(url)) ?? null;
  const classification: XhsRedirectClassification = serverRedirects.length > 0
    ? "SERVER_HTTP_REDIRECT"
    : authApiRejections.length > 0 && loginUrl
      ? "AUTH_API_REJECTION_THEN_CLIENT_REDIRECT"
      : loginUrl
        ? "CLIENT_SIDE_REDIRECT"
        : finalUrl
          ? "NO_LOGIN_REDIRECT"
          : "UNKNOWN";
  return { classification, finalUrl, loginUrl, serverRedirects, authApiRejections, frameNavigations, safeEvents };
}

type EventPage = Page & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
};

/** Captures only URL paths, methods, status codes and timing-free redirect signals. */
export class XhsNavigationDiagnosticsTracker {
  private readonly events: XhsNavigationEvent[] = [];
  private readonly handlers: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];

  attach(page: Page): void {
    const candidate = page as EventPage;
    const add = (event: string, listener: (...args: unknown[]) => void): void => {
      if (typeof candidate.on !== "function") return;
      candidate.on(event, listener);
      this.handlers.push({ event, listener });
    };
    add("request", (raw: unknown) => {
      const request = raw as { url?: () => string; method?: () => string; resourceType?: () => string };
      const url = request.url?.() ?? "";
      const resourceType = request.resourceType?.() ?? "unknown";
      this.events.push({ kind: "request", url, method: request.method?.() ?? "UNKNOWN", resourceType, isDocument: resourceType === "document" });
    });
    add("response", (raw: unknown) => {
      const response = raw as { url?: () => string; status?: () => number; request?: () => { resourceType?: () => string }; headerValue?: (name: string) => Promise<string | null> };
      const url = response.url?.() ?? "";
      const resourceType = response.request?.().resourceType?.() ?? "unknown";
      const base = { kind: "response" as const, url, status: response.status?.() ?? 0, isDocument: resourceType === "document" };
      if (typeof response.headerValue === "function") void response.headerValue("location").then((location) => this.events.push({ ...base, location })).catch(() => this.events.push({ ...base, location: null }));
      else this.events.push({ ...base, location: null });
    });
    add("framenavigated", (raw: unknown) => {
      const frame = raw as { url?: () => string };
      this.events.push({ kind: "navigation", url: frame.url?.() ?? "" });
    });
  }

  detach(page: Page): void {
    const candidate = page as EventPage;
    if (typeof candidate.off === "function") for (const handler of this.handlers) candidate.off(handler.event, handler.listener);
    this.handlers.length = 0;
  }

  snapshot(): XhsNavigationEvent[] { return [...this.events]; }

  classify(): XhsNavigationClassification { return classifyXhsNavigationEvents(this.events); }
}
