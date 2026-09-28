import { createHash, randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright-core";
import { inspectDouyinMusicDocument, type DouyinMusicDomState } from "./image-text-music-dom";

export type DouyinPreMusicBinding = {
  accountId: string; articleId: string; jobId: string; preparationId: string;
  uploadOperationId: string; sessionIdHash: string; loginGeneration: number;
  sourceContentHash: string; imageSha256: string; previewDigest: string;
  editorObservationHash: string; editorUrl: string;
  page: Page; context: BrowserContext; musicSelectionCount: number;
};

export type DouyinPreMusicEvidence = DouyinPreMusicBinding & {
  classification: "NONE"; musicSelectionCountAtObservation: 0;
  evidenceId: string; observedAt: string; pageEpoch: number;
  diagnostic: Pick<DouyinMusicDomState, "classification" | "regionCount" | "entryNodeCount"
    | "selectedContainerCount" | "ambiguousNodes" | "drawerPresent">;
};

export class DouyinPreMusicInvariantError extends Error {
  readonly code = "USER_ACTION_REQUIRED";
  constructor(readonly reason: string) { super(reason); this.name = "DouyinPreMusicInvariantError"; }
}

const pageEpochs = new WeakMap<Page, { value: number }>();
function pageEpoch(page: Page): number {
  let state = pageEpochs.get(page);
  if (!state) {
    state = { value: 0 };
    pageEpochs.set(page, state);
    const retained = state;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) retained.value += 1; });
    page.on("close", () => { retained.value += 1; });
  }
  return state.value;
}

/** Hash only bounded editor evidence. The approved text itself stays in the existing frozen Article. */
export function hashDouyinPreMusicEditorObservation(input: {
  title: string; semanticBody: string; previewDigest: string; imageCount: number; settings: unknown;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function assertOwnedEditor(binding: DouyinPreMusicBinding): void {
  if (!binding.accountId || !binding.articleId || !binding.jobId || !binding.preparationId
    || !binding.uploadOperationId || !binding.sessionIdHash || !Number.isSafeInteger(binding.loginGeneration)
    || !/^[a-f0-9]{64}$/u.test(binding.sourceContentHash)
    || !/^[a-f0-9]{64}$/u.test(binding.imageSha256)
    || !/^[a-f0-9]{64}$/u.test(binding.previewDigest)
    || !/^[a-f0-9]{64}$/u.test(binding.editorObservationHash)
    || binding.musicSelectionCount !== 0 || binding.page.isClosed()
    || binding.page.context() !== binding.context || !binding.context.pages().includes(binding.page)
    || binding.page.url() !== binding.editorUrl
    || new URL(binding.editorUrl).origin !== "https://creator.douyin.com"
    || new URL(binding.editorUrl).pathname !== "/creator-micro/content/post/image")
    throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
}

/** Called after the strict title/body/image/settings gate, before any music drawer action. */
export async function inspectDouyinPreMusicReadOnly(binding: DouyinPreMusicBinding): Promise<DouyinPreMusicEvidence> {
  assertOwnedEditor(binding);
  const epochBefore = pageEpoch(binding.page);
  const state = await binding.page.evaluate(inspectDouyinMusicDocument);
  if (epochBefore !== pageEpoch(binding.page) || binding.page.isClosed() || binding.page.url() !== binding.editorUrl)
    throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
  if (state.classification !== "NONE") {
    const reason = state.classification === "TRACK" ? "DOUYIN_PRE_MUSIC_UNEXPECTED_TRACK"
      : state.classification === "AMBIGUOUS" ? "DOUYIN_PRE_MUSIC_AMBIGUOUS" : "DOUYIN_PRE_MUSIC_UNKNOWN";
    throw new DouyinPreMusicInvariantError(reason);
  }
  if (state.drawerPresent)
    throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_DRAWER_ALREADY_OPEN");
  return { ...binding, classification: "NONE", musicSelectionCountAtObservation: 0,
    evidenceId: randomUUID(), observedAt: new Date().toISOString(), pageEpoch: epochBefore,
    diagnostic: { classification: state.classification, regionCount: state.regionCount,
      entryNodeCount: state.entryNodeCount, selectedContainerCount: state.selectedContainerCount,
      ambiguousNodes: state.ambiguousNodes, drawerPresent: state.drawerPresent } };
}

/** Refuses an old process, Page, Context, navigation epoch, upload operation or editor fingerprint. */
export function assertDouyinPreMusicEvidenceCurrent(evidence: DouyinPreMusicEvidence,
  current: DouyinPreMusicBinding): void {
  assertOwnedEditor(current);
  if (evidence.classification !== "NONE" || evidence.musicSelectionCountAtObservation !== 0
    || evidence.pageEpoch !== pageEpoch(evidence.page)
    || evidence.page !== current.page || evidence.context !== current.context
    || evidence.accountId !== current.accountId || evidence.articleId !== current.articleId
    || evidence.jobId !== current.jobId || evidence.preparationId !== current.preparationId
    || evidence.uploadOperationId !== current.uploadOperationId
    || evidence.sessionIdHash !== current.sessionIdHash || evidence.loginGeneration !== current.loginGeneration
    || evidence.sourceContentHash !== current.sourceContentHash
    || evidence.imageSha256 !== current.imageSha256 || evidence.previewDigest !== current.previewDigest
    || evidence.editorObservationHash !== current.editorObservationHash
    || evidence.editorUrl !== current.editorUrl)
    throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
}
