/** A bounded, read-only classification of the image editor's music surface. */
export interface DouyinMusicDomState {
  classification: "NONE" | "TRACK" | "AMBIGUOUS" | "UNKNOWN";
  regionCount: number;
  entryNodeCount: number;
  entryText: string | null;
  selectedContainerCount: number;
  selectedTrack: { trackId: string | null; title: string; artist: string; duration: string } | null;
  selectedTrackConfidence: "EXPLICIT_CONTAINER" | "NONE";
  drawerPresent: boolean;
  ambiguousNodes: number;
  ambiguousNodeSummaries: Array<{ tag: string; role: string | null; classSummary: string;
    dataKeys: string[]; selected: string | null; disabled: boolean }>;
}

/** Runs inside the owned Page. No page-wide title query may establish selected music. */
export function inspectDouyinMusicDocument(): DouyinMusicDomState {
  const empty = (classification: DouyinMusicDomState["classification"]): DouyinMusicDomState => ({
    classification, regionCount: 0, entryNodeCount: 0, entryText: null,
    selectedContainerCount: 0, selectedTrack: null, selectedTrackConfidence: "NONE",
    drawerPresent: false, ambiguousNodes: 0, ambiguousNodeSummaries: []
  });
  const main = document.querySelectorAll("main");
  if (main.length !== 1) return empty("UNKNOWN");
  const editor = main[0]!;
  const visible = (element: Element): boolean => {
    const html = element as HTMLElement;
    return html.getBoundingClientRect().width > 0 && html.getBoundingClientRect().height > 0;
  };
  const text = (element: Element | null): string => (element?.textContent ?? "").trim().slice(0, 120);
  const summarize = (element: Element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
    classSummary: String(element.className).slice(0, 80),
    dataKeys: [...element.attributes].filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => attribute.name).slice(0, 8),
    selected: element.getAttribute("aria-selected"), disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" });
  const drawerSearch = [...document.querySelectorAll('input[placeholder="搜索音乐"]')].filter(visible);
  const drawerPresent = drawerSearch.length > 0;
  const entries = [...editor.querySelectorAll("button,span,div,[role='button']")]
    .filter((element) => visible(element) && ["选择音乐", "点击添加合适作品风格音乐"].includes(text(element))
      && ![...element.children].some((child) => text(child) === text(element)));
  const regions = [...editor.querySelectorAll('[data-douyin-music-region], [class*="music-setting"], [class*="musicSetting"], [class*="music-info"], [class*="musicInfo"]')]
    .filter(visible);
  // The unselected Creator control can lack a named region. Its direct parent is the smallest safe surface.
  if (regions.length === 0 && entries.length === 1 && entries[0]!.parentElement)
    regions.push(entries[0]!.parentElement!);
  const result: DouyinMusicDomState = { ...empty("UNKNOWN"), regionCount: regions.length,
    entryNodeCount: entries.length, entryText: entries.length > 0 ? entries.map(text).join(" | ").slice(0, 120) : null,
    drawerPresent };
  const entryLabels = entries.map(text);
  if (regions.length !== 1 || new Set(entryLabels).size !== entryLabels.length || entries.length > 2) {
    result.classification = regions.length > 1 || new Set(entryLabels).size !== entryLabels.length || entries.length > 2 ? "AMBIGUOUS" : "UNKNOWN";
    return result;
  }
  const region = regions[0]!;
  if (entries.some((entry) => !region.contains(entry))) { result.classification = "AMBIGUOUS"; return result; }
  const drawerRoots = drawerSearch.map((search) => search.closest('[role="dialog"], [class*="music-drawer"], [class*="musicDrawer"], [class*="music-modal"], [class*="musicModal"]')).filter((root): root is Element => root !== null);
  const outsideSignals = [...editor.querySelectorAll('[data-selected-music], [data-selected-track], [class*="selected-music"], [class*="music-selected"], [class*="selectedMusic"], [class*="musicSelected"], [class*="music-card"], [class*="music-chip"]')]
    .filter((element) => visible(element) && !region.contains(element) && !drawerRoots.some((drawer) => drawer.contains(element)));
  if (outsideSignals.length > 0) { result.classification = "AMBIGUOUS"; result.ambiguousNodes = outsideSignals.length;
    result.ambiguousNodeSummaries = outsideSignals.slice(0, 8).map(summarize); return result; }
  // Only a dedicated selected-track container is evidence of a bound track.
  const selected = [...region.querySelectorAll('[data-selected-music], [data-selected-track], [class*="selected-music"], [class*="music-selected"], [class*="selectedMusic"], [class*="musicSelected"]')]
    .filter(visible);
  result.selectedContainerCount = selected.length;
  const unexplained = [...region.querySelectorAll('[data-music-id], [data-track-id], [aria-selected="true"], [class*="music-card"], [class*="music-chip"], [class*="musicCard"], [class*="musicChip"]')]
    .filter((element) => visible(element) && !selected.some((container) => container === element || container.contains(element)));
  result.ambiguousNodes = unexplained.length;
  result.ambiguousNodeSummaries = unexplained.slice(0, 8).map(summarize);
  if (selected.length > 1 || unexplained.length > 0) { result.classification = "AMBIGUOUS"; return result; }
  if (selected.length === 0) {
    // A known unselected entry is required; absence of a recognized song alone is not proof of NONE.
    result.classification = entries.length > 0 ? "NONE" : "UNKNOWN";
    return result;
  }
  if (entries.length === 0) { result.classification = "UNKNOWN"; return result; }
  const card = selected[0]!;
  const title = text(card.querySelector('[data-track-title], [data-title], [class*="track-title"], [class*="music-title"]'));
  const artist = text(card.querySelector('[data-track-artist], [data-artist], [class*="artist"]'));
  const duration = text(card.querySelector('[data-track-duration], [class*="duration"], time'));
  const trackId = card.getAttribute("data-selected-music") || card.getAttribute("data-selected-track")
    || card.getAttribute("data-music-id") || card.getAttribute("data-track-id") || null;
  if (!title || title === "选择音乐" || title === "点击添加合适作品风格音乐" || !artist || !duration) {
    result.classification = "AMBIGUOUS";
    return result;
  }
  result.classification = "TRACK";
  result.selectedTrack = { trackId, title, artist, duration };
  result.selectedTrackConfidence = "EXPLICIT_CONTAINER";
  return result;
}
