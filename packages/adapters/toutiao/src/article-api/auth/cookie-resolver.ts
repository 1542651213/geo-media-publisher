export interface ToutiaoCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly hostOnly: boolean;
  readonly secure: boolean;
  readonly expiresAt: string | null;
}

export class ToutiaoCookieError extends Error {
  readonly code = "TOUTIAO_COOKIE_UNAVAILABLE";
  constructor() { super("Required creator cookies are unavailable"); }
}

function eligible(cookie: ToutiaoCookie, hostname: string, now: Date): boolean {
  const domain = cookie.domain.toLowerCase().replace(/^\./u, "");
  if (!cookie.name || !cookie.value || /[\r\n;]/u.test(cookie.name) || /[\r\n]/u.test(cookie.value)) return false;
  if (cookie.expiresAt && (!Number.isFinite(Date.parse(cookie.expiresAt)) || Date.parse(cookie.expiresAt) <= now.getTime())) return false;
  return cookie.hostOnly ? hostname === domain : hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Resolve duplicate names using exact creator host, then longest matching parent domain. */
export function resolveCreatorCookies(cookies: readonly ToutiaoCookie[], requiredNames: readonly string[], now = new Date(), hostname = "mp.toutiao.com"): { header: string; selected: readonly ToutiaoCookie[] } {
  const candidates = cookies.filter((cookie) => eligible(cookie, hostname, now));
  const byName = new Map<string, ToutiaoCookie>();
  for (const cookie of candidates) {
    const prior = byName.get(cookie.name);
    const rank = (item: ToutiaoCookie) => {
      const domain = item.domain.toLowerCase().replace(/^\./u, "");
      return (domain === hostname ? 1000 : 0) + domain.length * 2 + (item.hostOnly ? 1 : 0) + item.path.length / 1000;
    };
    if (!prior || rank(cookie) > rank(prior) || rank(cookie) === rank(prior) && cookie.value < prior.value) byName.set(cookie.name, cookie);
  }
  if (requiredNames.some((name) => !byName.has(name))) throw new ToutiaoCookieError();
  const selected = [...byName.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { header: selected.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), selected };
}
