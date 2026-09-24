import type { ToutiaoCredentialBundle } from "./credential-bundle";
import { resolveCreatorCookies } from "./cookie-resolver";
import { assertToutiaoAuthEndpoint, requestToutiaoAuth, ToutiaoAuthResolutionError, type ToutiaoHttpTransport } from "./transport";

/** Pure resolver: the bundle service decides whether and when to store the new material. */
export async function resolveCsrfToken(bundle: ToutiaoCredentialBundle, transport: ToutiaoHttpTransport, endpoint: string, requiredCookies: readonly string[], allowedHosts: readonly string[] = ["mp.toutiao.com"]): Promise<{ value: string; observedAt: string }> {
  assertToutiaoAuthEndpoint(endpoint, allowedHosts);
  const cookie = resolveCreatorCookies(bundle.cookieMaterial, requiredCookies).header;
  let response;
  try { response = await requestToutiaoAuth(transport, { method: "GET", url: endpoint, headers: { Cookie: cookie } }); }
  catch { throw new ToutiaoAuthResolutionError("AUTH_TRANSPORT_UNKNOWN"); }
  if (response.status === 401 || response.status === 403) throw new ToutiaoAuthResolutionError("AUTH_EXPLICITLY_INVALID");
  const value = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "x-secsdk-csrf-token")?.[1];
  if (response.status < 200 || response.status >= 300 || !value) throw new ToutiaoAuthResolutionError("AUTH_RESPONSE_UNKNOWN");
  return { value, observedAt: new Date().toISOString() };
}
