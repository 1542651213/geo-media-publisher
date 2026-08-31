import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Xiaohongshu Task 10I navigation contract", () => {
  it("keeps Gate navigation and preparePublish policies explicit while sharing the resolver", () => {
    const source = read("packages/adapters/xiaohongshu/src/browser.ts");
    expect(source).toContain("resolvePublishNoteNavigationSurface");
    expect(source).toContain('"GATE_NAVIGATION"');
    expect(source).toContain('"PREPARE_PUBLISH"');
    expect(source).toContain("selectImagePostContentTypeForPrepare");
    expect(source).toContain('code: "PUBLISH_NOTE_SURFACE_RESOLVED"');
    expect(source).toContain('code: "PUBLISH_NOTE_SURFACE_PRECLICK_REVALIDATED"');
    expect(source).toContain('code: "PUBLISH_NOTE_NAVIGATION_CLICK_STARTED"');
    expect(source).toContain('code: "PUBLISH_NOTE_NAVIGATION_CLICK_COMPLETED"');
    expect(source).toContain('code: "POST_PUBLISH_NOTE_STATE_OBSERVED"');
  });

  it("keeps the resolved-surface Gate path free of click bypasses and content mutation", () => {
    const source = read("packages/adapters/xiaohongshu/src/browser.ts");
    const start = source.indexOf("navigateToImagePostEditorForGate");
    const end = source.indexOf("selectImagePostContentTypeForPrepare", start);
    const gatePath = source.slice(start, end >= 0 ? end : source.length);
    expect(gatePath).toContain("surfaceHandle");
    expect(gatePath).not.toContain("force: true");
    expect(gatePath).not.toContain("dispatchEvent");
    expect(gatePath).not.toContain("mouse.click");
    expect(gatePath).not.toContain("setInputFiles");
    expect(gatePath).not.toContain(".fill(");
    expect(gatePath).not.toContain("preparePublish(");
  });
});
