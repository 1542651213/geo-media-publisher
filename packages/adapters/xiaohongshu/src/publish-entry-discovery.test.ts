import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright-core";
import { collectPublishEntryCandidates, findPublishEntry } from "./browser";

type CandidateSpec = {
  tagName?: "a" | "button";
  role?: string | null;
  text?: string;
  href?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  dataTestId?: string | null;
  visible?: boolean;
  enabled?: boolean;
};

type CandidateFixture = {
  page: Page;
  collectionLocator: Locator;
  candidateLocators: Locator[];
};

function makeCandidateLocator(spec: CandidateSpec): Locator {
  const attributes: Record<string, string | null> = {
    href: spec.href ?? null,
    "aria-label": spec.ariaLabel ?? null,
    title: spec.title ?? null,
    "data-testid": spec.dataTestId ?? null,
    role: spec.role ?? null
  };
  const candidate = {
    count: vi.fn(async () => 1),
    first: vi.fn(function (this: Locator) { return this; }),
    nth: vi.fn(function (this: Locator) { return this; }),
    isVisible: vi.fn(async () => spec.visible ?? true),
    isEnabled: vi.fn(async () => spec.enabled ?? true),
    innerText: vi.fn(async () => spec.text ?? ""),
    getAttribute: vi.fn(async (name: string) => attributes[name] ?? null),
    evaluate: vi.fn(async () => ({
      tagName: (spec.tagName ?? "button").toUpperCase(),
      role: spec.role ?? null,
      text: spec.text ?? "",
      href: spec.href ?? null,
      ariaLabel: spec.ariaLabel ?? null,
      title: spec.title ?? null,
      dataAttributes: spec.dataTestId ? { "data-testid": spec.dataTestId } : {},
      visible: spec.visible ?? true,
      enabled: spec.enabled ?? true
    })),
    click: vi.fn(async () => undefined)
  };
  return candidate as unknown as Locator;
}

function setupCandidatePage(specs: CandidateSpec[]): CandidateFixture {
  const candidateLocators = specs.map(makeCandidateLocator);
  const collectionLocator = {
    count: vi.fn(async () => candidateLocators.length),
    nth: vi.fn((index: number) => candidateLocators[index]!)
  } as unknown as Locator;
  const page = {
    locator: vi.fn(() => collectionLocator)
  } as unknown as Page;
  return { page, collectionLocator, candidateLocators };
}

describe("Xiaohongshu publish-entry candidate discovery", () => {
  it("finds an image-post anchor by stable publish href", async () => {
    const fixture = setupCandidatePage([{ tagName: "a", href: "https://creator.xiaohongshu.com/publish/publish?draft=ignored", text: "入口" }]);
    const snapshot = await collectPublishEntryCandidates(fixture.page);
    const result = findPublishEntry(snapshot);

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", strategy: "STABLE_HREF", selectorSignal: "href:/publish/publish" });
    expect(snapshot.candidates[0]).toMatchObject({ tagName: "A", sanitizedHref: "/publish/publish", visible: true, enabled: true });
  });

  it("finds a button by exact accessible name", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", text: "发布笔记" }]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", strategy: "ROLE_EXACT_NAME", selectorSignal: "role=button,name=发布笔记" });
  });

  it("finds an explicit role button by exact accessible name", async () => {
    const fixture = setupCandidatePage([{ tagName: "a", role: "button", text: "发布图文" }]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", strategy: "ROLE_EXACT_NAME", selectorSignal: "role=button,name=发布图文" });
  });

  it("finds a publish entry by aria-label or title", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", ariaLabel: "上传图文" }]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", strategy: "ARIA_LABEL_OR_TITLE", selectorSignal: "aria-label=上传图文" });
  });

  it("finds a publish entry by a stable data attribute", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", dataTestId: "publish-entry", text: "打开菜单" }]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", strategy: "STABLE_DATA_ATTRIBUTE", selectorSignal: "data-testid=publish-entry" });
  });

  it("does not treat a generic publish label as an image-post entry", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", text: "发布" }]);
    const snapshot = await collectPublishEntryCandidates(fixture.page);
    const result = findPublishEntry(snapshot);

    expect(snapshot.candidates).toHaveLength(1);
    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_NOT_FOUND" });
  });

  it("classifies a unique hidden semantic candidate without downgrading", async () => {
    const fixture = setupCandidatePage([
      { tagName: "a", href: "/publish/publish", text: "发布笔记", visible: false },
      { tagName: "button", text: "发布图文", visible: true }
    ]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_NOT_VISIBLE", selectorSignal: "href:/publish/publish" });
  });

  it("classifies a unique disabled semantic candidate without downgrading", async () => {
    const fixture = setupCandidatePage([
      { tagName: "button", dataTestId: "publish-entry", text: "发布笔记", enabled: false },
      { tagName: "button", text: "发布图文", visible: true }
    ]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_DISABLED", selectorSignal: "data-testid=publish-entry" });
  });

  it("fails closed when two candidates share the highest priority", async () => {
    const fixture = setupCandidatePage([
      { tagName: "a", href: "/publish/publish", text: "发布笔记" },
      { tagName: "a", href: "/publish/publish?entry=2", text: "发布图文" }
    ]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_AMBIGUOUS", failureStage: "PUBLISH_ENTRY_DISCOVERY" });
    expect(fixture.candidateLocators[0]!.click).not.toHaveBeenCalled();
    expect(fixture.candidateLocators[1]!.click).not.toHaveBeenCalled();
  });

  it("does not downgrade when stable href and stable data candidates coexist", async () => {
    const fixture = setupCandidatePage([
      { tagName: "a", href: "/publish/publish", text: "入口" },
      { tagName: "button", dataTestId: "publish-entry", text: "打开菜单" }
    ]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_AMBIGUOUS", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "multiple-equivalent-candidates" });
  });

  it("returns not-found when no publish-semantic candidate exists", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", text: "数据看板" }, { tagName: "a", href: "/help", text: "帮助" }]);
    const result = findPublishEntry(await collectPublishEntryCandidates(fixture.page));

    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY" });
  });

  it("bounds the candidate snapshot and scans the control collection once", async () => {
    const fixture = setupCandidatePage(Array.from({ length: 25 }, (_, index) => ({ tagName: "button", text: `无关控件${index}` })));
    const snapshot = await collectPublishEntryCandidates(fixture.page);
    const result = findPublishEntry(snapshot);

    expect(snapshot.candidates.length).toBeLessThanOrEqual(20);
    expect(fixture.page.locator).toHaveBeenCalledTimes(1);
    expect(fixture.collectionLocator.count).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "PUBLISH_ENTRY_NOT_FOUND" });
  });

  it("keeps candidate diagnostics free of HTML and storage fields", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", text: "发布笔记", ariaLabel: "发布笔记" }]);
    const snapshot = await collectPublishEntryCandidates(fixture.page);
    const candidate = snapshot.candidates[0]!;

    expect(candidate).not.toHaveProperty("innerHTML");
    expect(candidate).not.toHaveProperty("localStorage");
    expect(candidate).not.toHaveProperty("sessionStorage");
    expect(candidate).not.toHaveProperty("cookie");
    expect(JSON.stringify(candidate)).not.toMatch(/innerHTML|localStorage|sessionStorage|cookie/iu);
  });

  it("resolves from the same snapshot without rescanning or clicking", async () => {
    const fixture = setupCandidatePage([{ tagName: "button", text: "发布笔记" }]);
    const snapshot = await collectPublishEntryCandidates(fixture.page);
    const result = findPublishEntry(snapshot);

    expect(result.status).toBe("FOUND_UNIQUE");
    expect(fixture.page.locator).toHaveBeenCalledTimes(1);
    expect(fixture.candidateLocators[0]!.click).not.toHaveBeenCalled();
  });
});
