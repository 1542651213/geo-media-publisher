import type { ToutiaoCredentialBundle } from "./credential-bundle";
import { resolveCreatorCookies } from "./cookie-resolver";
import { assertToutiaoAuthEndpoint, requestToutiaoAuth, ToutiaoAuthResolutionError, type ToutiaoHttpTransport } from "./transport";

/** Response shape is a mockable contract; no live endpoint or protocol claim is made here. */
export async function resolveAntiToken(bundle: ToutiaoCredentialBundle, transport: ToutiaoHttpTransport, endpoint: string, requiredCookies: readonly string[], allowedHosts: readonly string[] = ["mp.toutiao.com"]): Promise<{ value: string; observedAt: string }> {
  assertToutiaoAuthEndpoint(endpoint, allowedHosts);
  const cookie = resolveCreatorCookies(bundle.cookieMaterial, requiredCookies).header;
  let response;
  try { response = await requestToutiaoAuth(transport, { method: "GET", url: endpoint, headers: { Cookie: cookie } }); }
  catch { throw new ToutiaoAuthResolutionError("AUTH_TRANSPORT_UNKNOWN"); }
  if (response.status === 401 || response.status === 403) throw new ToutiaoAuthResolutionError("AUTH_EXPLICITLY_INVALID");
  const body = response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : null;
  if (response.status < 200 || response.status >= 300 || !body || typeof body.antiToken !== "string" || !body.antiToken) throw new ToutiaoAuthResolutionError("AUTH_RESPONSE_UNKNOWN");
  return { value: body.antiToken, observedAt: new Date().toISOString() };
}
