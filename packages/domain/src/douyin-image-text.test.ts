import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeDouyinImageText, verifyDouyinImageTextImage } from "./douyin-image-text";

const folders: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=", "base64");

async function imagePath(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "douyin-image-text-"));
  folders.push(folder);
  const path = join(folder, "owner-test.png");
  await writeFile(path, png);
  return path;
}

afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

describe("Douyin image-text content binding", () => {
  it("freezes plain title, body, one image byte hash and account-specific BrowserNative transport", async () => {
    const path = await imagePath();
    const frozen = await freezeDouyinImageText({ articleId: "article-1", accountId: "account-1", creatorId: "creator-1", title: "测试标题", body: "测试正文", imagePaths: [path], topics: [], visibility: "public", scheduledAt: null });
    expect(frozen.imageHashes).toEqual([createHash("sha256").update(png).digest("hex")]);
    expect(frozen.sourceContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(frozen.contentBindingHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(frozen.transport).toBe("DOUYIN_BROWSER_NATIVE");
    expect(frozen.imagePaths).toEqual([path]);
    await expect(verifyDouyinImageTextImage(frozen, 0)).resolves.toBe(true);
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from([1])]));
    await expect(verifyDouyinImageTextImage(frozen, 0)).resolves.toBe(false);
  });

  it("rejects missing image, unsupported settings and non-plain content", async () => {
    const path = await imagePath();
    const base = { articleId: "article-1", accountId: "account-1", creatorId: "creator-1", title: "测试", body: "正文", imagePaths: [path], topics: [], visibility: "public" as const, scheduledAt: null };
    await expect(freezeDouyinImageText({ ...base, imagePaths: [] })).rejects.toThrow(/image/i);
    await expect(freezeDouyinImageText({ ...base, topics: ["话题"] })).rejects.toThrow(/topic/i);
    await expect(freezeDouyinImageText({ ...base, body: "<b>正文</b>" })).rejects.toThrow(/plain/i);
    await expect(freezeDouyinImageText({ ...base, creatorId: "" })).rejects.toThrow(/identity/i);
  });

  it("changes binding on account or creator identity while keeping source hash stable", async () => {
    const path = await imagePath();
    const base = { articleId: "article-1", accountId: "account-1", creatorId: "creator-1", title: "测试", body: "正文", imagePaths: [path], topics: [], visibility: "public" as const, scheduledAt: null };
    const a = await freezeDouyinImageText(base);
    const b = await freezeDouyinImageText({ ...base, accountId: "account-2" });
    expect(a.sourceContentHash).toBe(b.sourceContentHash);
    expect(a.contentBindingHash).not.toBe(b.contentBindingHash);
    const c = await freezeDouyinImageText({ ...base, body: "不同正文" });
    expect(a.sourceContentHash).not.toBe(c.sourceContentHash);
  });
});
