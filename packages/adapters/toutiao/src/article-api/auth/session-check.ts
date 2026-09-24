import type { ToutiaoCredentialBundle } from "./credential-bundle";
import { resolveCreatorCookies } from "./cookie-resolver";
import { assertToutiaoAuthEndpoint, requestToutiaoAuth, type ToutiaoHttpTransport } from "./transport";

export interface ToutiaoSessionCheckResult {
  readonly state: "VALID" | "INVALID" | "UNKNOWN";
  readonly reasonCode: "AUTHENTICATED" | "AUTH_REJECTED" | "NETWORK_UNKNOWN" | "SERVER_UNKNOWN" | "MALFORMED_RESPONSE" | "COOKIE_UNAVAILABLE";
  readonly httpStatus: number | null;
}

export async function checkCreatorSession(bundle: ToutiaoCredentialBundle, transport: ToutiaoHttpTransport, endpoint: string, requiredCookies: readonly string[], allowedHosts: readonly string[] = ["mp.toutiao.com"]): Promise<ToutiaoSessionCheckResult> {
  try { assertToutiaoAuthEndpoint(endpoint, allowedHosts); }
  catch { return { state: "UNKNOWN", reasonCode: "MALFORMED_RESPONSE", httpStatus: null }; }
  let cookie: string;
  try { cookie = resolveCreatorCookies(bundle.cookieMaterial, requiredCookies).header; }
  catch { return { state: "UNKNOWN", reasonCode: "COOKIE_UNAVAILABLE", httpStatus: null }; }
  try {
    const response = await requestToutiaoAuth(transport, { method: "GET", url: endpoint, headers: { Cookie: cookie } });
    if (response.status === 401 || response.status === 403) return { state: "INVALID", reasonCode: "AUTH_REJECTED", httpStatus: response.status };
    if (response.status >= 500) return { state: "UNKNOWN", reasonCode: "SERVER_UNKNOWN", httpStatus: response.status };
    if (response.status < 200 || response.status >= 300 || !response.body || typeof response.body !== "object") return { state: "UNKNOWN", reasonCode: "MALFORMED_RESPONSE", httpStatus: response.status };
    const authenticated = (response.body as Record<string, unknown>).authenticated;
    if (authenticated === true) return { state: "VALID", reasonCode: "AUTHENTICATED", httpStatus: response.status };
    if (authenticated === false) return { state: "INVALID", reasonCode: "AUTH_REJECTED", httpStatus: response.status };
    return { state: "UNKNOWN", reasonCode: "MALFORMED_RESPONSE", httpStatus: response.status };
  } catch { return { state: "UNKNOWN", reasonCode: "NETWORK_UNKNOWN", httpStatus: null }; }
}
