interface VerificationInput {
  publicUrl: string;
  operation: { environment: string; prepared: { slug: string; settings: { kind: string }; source: { title: string };
    draftPreview: { blocks: Array<{ text?: string; items?: string[] }> } }; media: Array<{ remote?: { mediaId: string } }> };
}
const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
function visibleText(value: string): string {
  return normalize(value.replace(/<[^>]*>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/giu,
    match => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#x27;": "'", "&nbsp;": " " })[match.toLowerCase()] ?? match));
}
async function boundedHtml(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); const pieces: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const piece = await reader.read(); if (piece.done) break;
      bytes += piece.value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel().catch(() => undefined); throw new Error("PUBLIC_HTML_TOO_LARGE"); }
      pieces.push(piece.value);
    }
    return Buffer.concat(pieces).toString("utf8");
  } finally { reader.releaseLock(); }
}

/** Independent fidelity only. A warning cannot authorize a second create or publish. */
export async function verifyOfficialApiPublicContent(input: VerificationInput): Promise<{ ok: boolean; warning?: string; evidence: Record<string, unknown> }> {
  const evidence: Record<string, unknown> = { rawSsr: true, mediaCount: input.operation.media.length, mediaHttp200: 0 };
  const fail = (warning: string) => ({ ok: false, warning, evidence });
  try {
    const origin = input.operation.environment === "production" ? "https://xn--4gq502b.com" : input.operation.environment === "staging" ? "https://staging.kangyihb.com" : "";
    const url = new URL(input.publicUrl);
    const path = `/${input.operation.prepared.settings.kind === "case" ? "cases" : "news"}/${input.operation.prepared.slug}`;
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/u, "") !== path) return fail("PUBLIC_URL_BINDING_MISMATCH");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { Accept: "text/html" } });
    evidence.status = response.status;
    if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); return fail("PUBLIC_PAGE_UNAVAILABLE"); }
    const html = (await boundedHtml(response)).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, "");
    const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(html)?.[1] ?? "";
    if (visibleText(heading) !== normalize(input.operation.prepared.source.title)) return fail("PUBLIC_TITLE_MISMATCH");
    const text = visibleText(html);
    if (input.operation.prepared.draftPreview.blocks.flatMap(block => block.items ?? (block.text ? [block.text] : [])).some(value => !text.includes(normalize(value)))) return fail("PUBLIC_BODY_MISMATCH");
    const sources = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)].map(match => match[1]!);
    for (const media of input.operation.media) {
      if (!media.remote || !/^[0-9a-f-]{36}$/u.test(media.remote.mediaId)) return fail("PUBLIC_MEDIA_BINDING_MISSING");
      const path = `/media/${media.remote.mediaId}`;
      const source = sources.find(source => { try { const image = new URL(source, url); return image.origin === origin && image.pathname === path; } catch { return false; } });
      if (!source) return fail("PUBLIC_SSR_IMAGE_MISSING");
      const image = await fetch(new URL(source, url), { redirect: "manual", signal: AbortSignal.timeout(10000) });
      await image.body?.cancel().catch(() => undefined);
      if (image.status !== 200) return fail("PUBLIC_MEDIA_UNAVAILABLE");
      evidence.mediaHttp200 = Number(evidence.mediaHttp200) + 1;
    }
    return { ok: true, evidence };
  } catch { return fail("PUBLIC_FIDELITY_CHECK_UNAVAILABLE"); }
}
