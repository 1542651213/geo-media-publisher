export interface ToutiaoHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}
export interface ToutiaoHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}
/** No production transport is provided in R1-C. Tests inject a fixture implementation. */
export interface ToutiaoHttpTransport {
  readonly mode: "MOCK" | "REAL";
  request(input: ToutiaoHttpRequest): Promise<ToutiaoHttpResponse>;
}
export const REAL_TOUTIAO_HTTP_ENABLED = false;

export function requestToutiaoAuth(transport: ToutiaoHttpTransport, input: ToutiaoHttpRequest): Promise<ToutiaoHttpResponse> {
  if (transport.mode !== "MOCK" && !REAL_TOUTIAO_HTTP_ENABLED) throw new ToutiaoAuthResolutionError("AUTH_TRANSPORT_UNKNOWN");
  return transport.request(input);
}

export class ToutiaoAuthResolutionError extends Error {
  constructor(readonly code: "AUTH_RESPONSE_UNKNOWN" | "AUTH_EXPLICITLY_INVALID" | "AUTH_TRANSPORT_UNKNOWN") { super(code); }
}

/** Never send a creator Cookie to an arbitrary injected endpoint. */
export function assertToutiaoAuthEndpoint(endpoint: string, allowedHosts: readonly string[]): void {
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase()) && !url.username && !url.password) return;
  } catch { /* invalid endpoint */ }
  throw new ToutiaoAuthResolutionError("AUTH_RESPONSE_UNKNOWN");
}
