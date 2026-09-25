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
}

export type ToutiaoManagementState = "DRAFT" | "REVIEWING" | "SCHEDULED" | "PUBLISHED" | "REJECTED"
  | "UNKNOWN" | "NOT_FOUND" | "AMBIGUOUS";
export interface ToutiaoManagementMatch {
  readonly state: ToutiaoManagementState;
  readonly externalId: string | null;
  readonly publicUrl: string | null;
  readonly matchedRowCount: number;
}

const clean = (value: string): string => value.normalize("NFC").replace(/\s+/gu, " ").trim();

function rowId(row: ToutiaoManagementRow): string | null {
  if (row.href) {
    try {
      const url = new URL(row.href, "https://mp.toutiao.com/profile_v4/manage/content/all");
      if (!/^(?:mp|www)\.toutiao\.com$/u.test(url.hostname)) return null;
      const fromUrl = url.pathname.match(/^\/(?:article|item|w)\/(\d+)\/?$/u)?.[1]
        ?? url.searchParams.get("pgc_id")?.match(/^\d+$/u)?.[0] ?? null;
      if (fromUrl) return fromUrl;
    } catch { return null; }
  }
  return row.dataId && /^\d+$/u.test(row.dataId) ? row.dataId : null;
}

function publicUrl(row: ToutiaoManagementRow, id: string | null): string | null {
  if (!row.href || !id) return null;
  try {
    const url = new URL(row.href, "https://mp.toutiao.com");
    return /^(?:www\.)?toutiao\.com$/u.test(url.hostname)
      && new RegExp(`^/(?:article|item|w)/${id}/?$`, "u").test(url.pathname) ? url.toString() : null;
  } catch { return null; }
}

function withinWindow(rowText: string, submittedAt: string): boolean {
  const at = Date.parse(submittedAt);
  if (!Number.isFinite(at)) return false;
  for (let offset = -15; offset <= 15; offset += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(at + offset * 60_000));
    const part = (name: string): string => parts.find((item) => item.type === name)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const time = `${part("hour")}:${part("minute")}`;
    if (rowText.includes(`${date} ${time}`) || rowText.includes(`${part("month")}-${part("day")} ${time}`)
      || rowText.includes(`${part("month")}/${part("day")} ${time}`)) return true;
  }
  return false;
}

function stateOf(text: string): ToutiaoManagementState {
  const states: ToutiaoManagementState[] = [];
  if (/草稿/u.test(text)) states.push("DRAFT");
  if (/审核中|待审核|审核未完成/u.test(text)) states.push("REVIEWING");
  if (/定时待发布|定时发布|预约发布/u.test(text)) states.push("SCHEDULED");
  if (/已发布/u.test(text)) states.push("PUBLISHED");
  if (/已拒绝|审核未通过|发布失败/u.test(text)) states.push("REJECTED");
  return states.length === 1 ? states[0] : "UNKNOWN";
}

/** No match, an ambiguous row, or a missing identity never proves non-publication. */
export function matchToutiaoManagementRows(rows: readonly ToutiaoManagementRow[], target: ToutiaoManagementTarget): ToutiaoManagementMatch {
  const unknown = (state: ToutiaoManagementState, count = 0): ToutiaoManagementMatch =>
    ({ state, externalId: null, publicUrl: null, matchedRowCount: count });
  if (!target.accountIdentityVerified || !target.title.trim()) return unknown("UNKNOWN");
  const candidates = rows.filter((row) => clean(row.title) === clean(target.title)
    && (target.remoteId ? rowId(row) === target.remoteId : withinWindow(row.rowText, target.submittedAt)));
  if (candidates.length === 0) return unknown("NOT_FOUND");
  if (candidates.length !== 1) return unknown("AMBIGUOUS", candidates.length);
  const selected = candidates[0];
  const id = rowId(selected);
  return { state: stateOf(selected.rowText), externalId: id, publicUrl: publicUrl(selected, id), matchedRowCount: 1 };
}
