import { sanitizeToutiaoResponseDiagnostic } from "./article-api/captured-request-replay";

export interface ToutiaoManagementRow {
  readonly title: string;
  /** Transient DOM text for one bounded row. Never persist or log it. */
  readonly rowText: string;
  readonly href: string | null;
  readonly dataId: string | null;
}

export interface ToutiaoManagementTarget {
  readonly title: string;
  readonly submittedAt: string;
  readonly accountIdentityVerified: boolean;
  readonly remoteId: string | null;
  readonly windowStart?: string;
  readonly windowEnd?: string;
}

export type ToutiaoManagementState = "DRAFT" | "REVIEWING" | "SCHEDULED" | "PUBLISHED" | "REJECTED"
  | "UNKNOWN" | "NOT_FOUND" | "AMBIGUOUS";
export interface ToutiaoManagementMatch {
  readonly state: ToutiaoManagementState;
  readonly externalId: string | null;
  readonly publicUrl: string | null;
  readonly matchedRowCount: number;
  readonly titleMatch: boolean;
  readonly timeWindowMatch: boolean;
  readonly matchedBy: "REMOTE_ID" | "TITLE_AND_TIME" | null;
  readonly sanitizedRejectReason?: string | null;
}

const clean = (value: string): string => value.normalize("NFC").replace(/\s+/gu, " ").trim();

export function toutiaoManagementRowId(row: ToutiaoManagementRow): string | null {
  if (row.href) {
    try {
      const url = new URL(row.href, "https://mp.toutiao.com/profile_v4/manage/content/all");
      if (!/^(?:mp|www)\.toutiao\.com$/u.test(url.hostname)) return null;
      const fromUrl = url.pathname.match(/^\/(?:article|item|w)\/(\d+)\/?$/u)?.[1]
        ?? url.searchParams.get("pgc_id")?.match(/^\d+$/u)?.[0] ?? null;
      if (fromUrl && !/^0+$/u.test(fromUrl)) return fromUrl;
    } catch { return null; }
  }
  return row.dataId && /^[1-9]\d*$/u.test(row.dataId) ? row.dataId : null;
}

function publicUrl(row: ToutiaoManagementRow, id: string | null): string | null {
  if (!row.href || !id) return null;
  try {
    const url = new URL(row.href, "https://mp.toutiao.com");
    return /^(?:www\.)?toutiao\.com$/u.test(url.hostname)
      && new RegExp(`^/(?:article|item|w)/${id}/?$`, "u").test(url.pathname) ? url.toString() : null;
  } catch { return null; }
}

export function parseToutiaoRowTime(text: string, submittedAt: string): number | null {
  const full = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/u);
  const short = full ? null : text.match(/(?:^|\s)(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/u);
  const year = full ? Number(full[1]) : new Date(Date.parse(submittedAt) + 8 * 60 * 60_000).getUTCFullYear();
  const month = Number(full?.[2] ?? short?.[1]); const day = Number(full?.[3] ?? short?.[2]);
  const hour = Number(full?.[4] ?? short?.[3]); const minute = Number(full?.[5] ?? short?.[4]);
  if (![year, month, day, hour, minute].every(Number.isInteger) || month < 1 || month > 12
    || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  return local.getTime() - 8 * 60 * 60_000;
}

function withinWindow(rowText: string, target: ToutiaoManagementTarget): boolean {
  const at = Date.parse(target.submittedAt);
  const time = parseToutiaoRowTime(rowText, target.submittedAt);
  const start = target.windowStart ? Date.parse(target.windowStart) : at - 15 * 60_000;
  const end = target.windowEnd ? Date.parse(target.windowEnd) : at + 15 * 60_000;
  // The platform row exposes minute precision. Match its minute interval to the frozen window.
  return time !== null && Number.isFinite(start) && Number.isFinite(end) && start <= end
    && time + 59_999 >= start && time <= end;
}

function stateOf(text: string): ToutiaoManagementState {
  const states: ToutiaoManagementState[] = [];
  if (/草稿/u.test(text)) states.push("DRAFT");
  if (/审核中|待审核|审核未完成/u.test(text)) states.push("REVIEWING");
  if (/定时待发布|定时发布|预约发布/u.test(text)) states.push("SCHEDULED");
  if (/已发布/u.test(text)) states.push("PUBLISHED");
  if (/已拒绝|未通过|发布失败/u.test(text)) states.push("REJECTED");
  return states.length === 1 ? states[0] : "UNKNOWN";
}

function explicitRejectReason(rowText: string): string | null {
  const fields = [...rowText.matchAll(/(?:未通过原因|审核失败原因|驳回原因|拒绝原因|原因)\s*[:：]\s*([^|\r\n]+)/gu)];
  if (fields.length !== 1) return null;
  const value = fields[0]![1]!.trim();
  // Diagnostic reasons never retain phone numbers, account identifiers or contact values.
  const securityText = value.normalize("NFKC");
  if (/\d{7,}|[\w.+-]+@|(?:微信|QQ|手机号|电话)\s*[:：]\s*[\w+-]+/iu.test(securityText)) return null;
  return sanitizeToutiaoResponseDiagnostic(value);
}

/** No match, an ambiguous row, or a missing identity never proves non-publication. */
export function matchToutiaoManagementRows(rows: readonly ToutiaoManagementRow[], target: ToutiaoManagementTarget): ToutiaoManagementMatch {
  const unknown = (state: ToutiaoManagementState, count = 0): ToutiaoManagementMatch =>
    ({ state, externalId: null, publicUrl: null, matchedRowCount: count,
      titleMatch: false, timeWindowMatch: false, matchedBy: null, sanitizedRejectReason: null });
  if (!target.accountIdentityVerified || !target.title.trim()) return unknown("UNKNOWN");
  const candidates = rows.filter((row) => target.remoteId ? toutiaoManagementRowId(row) === target.remoteId
    : clean(row.title) === clean(target.title) && withinWindow(row.rowText, target));
  const groups = new Map<string, ToutiaoManagementRow[]>();
  for (const row of candidates) {
    const key = toutiaoManagementRowId(row) ?? `${clean(row.title)}\0${clean(row.rowText)}\0${row.href ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (groups.size === 0) return unknown("NOT_FOUND");
  if (groups.size !== 1) return unknown("AMBIGUOUS", groups.size);
  const group = [...groups.values()][0]!;
  const selected = group[0]!;
  const states = new Set(group.map((row) => stateOf(row.rowText)));
  const state = states.size === 1 ? states.values().next().value! : "UNKNOWN";
  const reasons = new Set(state === "REJECTED" ? group.map((row) => explicitRejectReason(row.rowText))
    .filter((reason): reason is string => reason !== null) : []);
  const id = toutiaoManagementRowId(selected);
  return { state, externalId: id,
    publicUrl: group.map((row) => publicUrl(row, id)).find((url) => url !== null) ?? null, matchedRowCount: 1,
    titleMatch: group.every((row) => clean(row.title) === clean(target.title)),
    timeWindowMatch: group.some((row) => withinWindow(row.rowText, target)),
    matchedBy: target.remoteId ? "REMOTE_ID" : "TITLE_AND_TIME",
    sanitizedRejectReason: reasons.size === 1 ? [...reasons][0]! : null };
}
