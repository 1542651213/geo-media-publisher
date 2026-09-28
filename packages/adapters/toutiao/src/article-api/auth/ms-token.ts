import type { ToutiaoCredentialBundle } from "./credential-bundle";
import { assertToutiaoAuthEndpoint, requestToutiaoAuth, ToutiaoAuthResolutionError, type ToutiaoHttpTransport } from "./transport";

/** mssdk protocol and token generation are deferred; this resolver only consumes injected fixture transport. */
export async function resolveMsToken(_bundle: ToutiaoCredentialBundle, transport: ToutiaoHttpTransport, endpoint: string, _requiredCookies: readonly string[], allowedHosts: readonly string[] = ["mssdk.bytedance.com"]): Promise<{ value: string; observedAt: string }> {
  assertToutiaoAuthEndpoint(endpoint, allowedHosts);
  let response;
  try { response = await requestToutiaoAuth(transport, { method: "GET", url: endpoint, headers: {} }); }
  catch { throw new ToutiaoAuthResolutionError("AUTH_TRANSPORT_UNKNOWN"); }
  if (response.status === 401 || response.status === 403) throw new ToutiaoAuthResolutionError("AUTH_EXPLICITLY_INVALID");
  const body = response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : null;
  if (response.status < 200 || response.status >= 300 || !body || typeof body.msToken !== "string" || !body.msToken) throw new ToutiaoAuthResolutionError("AUTH_RESPONSE_UNKNOWN");
  return { value: body.msToken, observedAt: new Date().toISOString() };
}
