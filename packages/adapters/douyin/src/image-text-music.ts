import { randomInt } from "node:crypto";
import type { Locator, Page } from "playwright-core";
import { inspectDouyinMusicDocument, type DouyinMusicDomState } from "./image-text-music-dom";
import type { DouyinMusicBinding } from "@publisher/domain/douyin-image-text";

export interface DouyinMusicIdentity {
  trackId: string | null;
  title: string;
  artist: string;
  duration: string;
}

export interface DouyinMusicCandidate extends DouyinMusicIdentity {
  sourceTab: "推荐";
  selectable: boolean;
  usageText: string;
  rowIndex?: number;
}

const excluded = /恋爱|失恋|分手|婚礼|表白|悲伤|伤心|喊麦|蹦迪|夜店|恶搞|搞笑|鬼畜|儿童|游戏|节庆|开门红|新年|春节|中秋|国庆|生日/u;
const suitable = /轻音乐|纯音乐|舒缓|清新|生活|家居|环境|治愈|氛围|科技|轻快|钢琴|安静|温柔|器乐|ambient|instrumental|piano|soft|calm/iu;

export function scoreDouyinEducationalMusic(item: DouyinMusicCandidate): number {
  const text = `${item.title} ${item.artist} ${item.usageText}`;
  if (excluded.test(text)) return -100;
  const matches = text.match(new RegExp(suitable.source, "giu"));
  return matches ? 2 + Math.min(matches.length, 3) : 0;
}

export function douyinMusicIdentityKey(item: DouyinMusicIdentity): string | null {
  if (item.trackId?.trim()) return `id:${item.trackId.trim()}`;
  if (!item.title.trim() || !item.artist.trim() || !item.duration.trim()) return null;
  return `text:${item.title.trim()}\u0000${item.artist.trim()}\u0000${item.duration.trim()}`;
}

/** Never draw randomly until the bounded visible pool is safe and deduplicated. */
export function chooseDouyinMusic(candidates: readonly DouyinMusicCandidate[], recent: readonly DouyinMusicIdentity[],
  random: () => number = () => randomInt(0, 0x100000000) / 0x100000000): {
    selected: DouyinMusicCandidate | null; eligibleCount: number; recentExcludedCount: number;
  } {
  const recentKeys = new Set(recent.slice(0, 10).flatMap((item) => {
    const keys = [douyinMusicIdentityKey(item)];
    if (item.title.trim() && item.artist.trim() && item.duration.trim())
      keys.push(`text:${item.title.trim()}\u0000${item.artist.trim()}\u0000${item.duration.trim()}`);
    return keys.filter((key): key is string => key !== null);
  }));
  let recentExcludedCount = 0;
  const seen = new Set<string>();
  const eligible = candidates.filter((item) => {
    const key = douyinMusicIdentityKey(item);
    if (!item.selectable || !key || !item.title.trim() || !item.artist.trim() || !item.duration.trim()
      || item.sourceTab !== "推荐" || scoreDouyinEducationalMusic(item) < 2) return false;
    const textKey = `text:${item.title.trim()}\u0000${item.artist.trim()}\u0000${item.duration.trim()}`;
    if (recentKeys.has(key) || recentKeys.has(textKey)) { recentExcludedCount += 1; return false; }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (eligible.length === 0) return { selected: null, eligibleCount: 0, recentExcludedCount };
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("DOUYIN_MUSIC_RANDOM_SOURCE_INVALID");
  return { selected: eligible[Math.floor(draw * eligible.length)]!, eligibleCount: eligible.length, recentExcludedCount };
}

export type DouyinMusicReadback = DouyinMusicDomState;

/** Compare the frozen effective remote content, never the requested recommendation policy. */
export function assertDouyinMusicReadback(expected: DouyinMusicBinding, observed: DouyinMusicReadback): "PASS_NONE" | "PASS_TRACK" {
  if (expected.mode === "NONE") {
    if (observed.classification === "NONE") return "PASS_NONE";
    throw new Error("DOUYIN_MUSIC_READBACK_MISMATCH");
  }
  const track = observed.selectedTrack;
  if (observed.classification !== "TRACK" || !track || track.title !== expected.title
    || track.artist !== expected.artist || track.duration !== expected.duration
    || (expected.trackId && track.trackId !== expected.trackId)
    || (expected.trackId ? `id:${expected.trackId.trim()}` :
      `text:${track.title.trim()}\u0000${track.artist.trim()}\u0000${track.duration.trim()}`) !== expected.identity)
    throw new Error("DOUYIN_MUSIC_READBACK_MISMATCH");
  return "PASS_TRACK";
}

export const douyinMusicRowSelector = '[data-music-id], [data-track-id], [role="listitem"]';

export function douyinMusicDrawerRows(page: Page): Locator {
  return page.locator('[role="dialog"], [class*="music-drawer"], [class*="musicDrawer"], [class*="music-modal"], [class*="musicModal"]')
    .filter({ has: page.getByPlaceholder("搜索音乐") }).locator(douyinMusicRowSelector);
}

/** Read a bounded first screen only. The DOM, not historical screenshots, supplies candidates. */
export async function inspectRecommendedDouyinMusic(page: Page): Promise<{ candidates: DouyinMusicCandidate[]; entryFound: boolean }> {
  const entry = page.getByText("选择音乐", { exact: true });
  if (await entry.count() !== 1 || !await entry.isVisible()) return { candidates: [], entryFound: false };
  await entry.click();
  const search = page.getByPlaceholder("搜索音乐");
  await search.first().waitFor({ state: "visible", timeout: 8_000 });
  const tab = page.getByText("推荐", { exact: true });
  if (await tab.count() !== 1 || !await tab.isVisible()) throw new Error("DOUYIN_MUSIC_RECOMMENDED_TAB_AMBIGUOUS");
  // Creator's current DOM must expose row-local track metadata. Unknown structure stays optional.
  const drawer = page.locator('[role="dialog"], [class*="music-drawer"], [class*="musicDrawer"], [class*="music-modal"], [class*="musicModal"]')
    .filter({ has: search });
  // An unscoped row could belong to the editor or another page surface. Empty is a safe optional result.
  if (await drawer.count() !== 1) return { candidates: [], entryFound: true };
  const candidates = await drawer.locator(douyinMusicRowSelector).evaluateAll((elements) => elements.slice(0, 30).map((element, rowIndex) => {
    const text = (element.textContent ?? "").trim();
    const title = element.querySelector('[class*="title"], [data-title]')?.textContent?.trim() ?? "";
    const artist = element.querySelector('[class*="artist"], [data-artist]')?.textContent?.trim() ?? "";
    const duration = element.querySelector('[class*="duration"], time')?.textContent?.trim() ?? "";
    const id = element.getAttribute("data-music-id") ?? element.getAttribute("data-track-id");
    return { trackId: id, title, artist, duration, sourceTab: "推荐" as const, rowIndex,
      selectable: !(element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled")), usageText: text.slice(0, 160) };
  }));
  return { candidates, entryFound: true };
}

export async function readSelectedDouyinMusic(page: Page): Promise<DouyinMusicReadback> {
  return page.evaluate(inspectDouyinMusicDocument);
}
