import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { imageSize } from "image-size";
import type { AppRepository } from "@publisher/db";
import type { ImageAsset } from "@publisher/domain";

export interface OperationsAsset extends ImageAsset {
  width: number | null; height: number | null; orientation: "portrait" | "landscape" | "square" | "unknown";
  usedByArticleCount: number; usedByJobCount: number; lastUsedPlatform: string | null;
  platformSuitability: Array<{ platformKey: string; status: "符合当前平台已知要求" | "可能不适合" | "未知" }>;
  duplicate?: boolean;
}
const formats: Record<string, { mime: string; extension: string }> = { jpg: { mime: "image/jpeg", extension: ".jpg" }, png: { mime: "image/png", extension: ".png" }, webp: { mime: "image/webp", extension: ".webp" }, gif: { mime: "image/gif", extension: ".gif" }, bmp: { mime: "image/bmp", extension: ".bmp" } };

export class OperationsAssets {
  constructor(private readonly repository: AppRepository, private readonly directory: string) {}
  list(companyId: string): OperationsAsset[] { return this.repository.listImageAssets(companyId).map(asset => this.view(asset)); }
  import(companyId: string, paths: string[], metadata: Partial<Pick<ImageAsset, "name" | "tags" | "business" | "city" | "usage" | "platform" | "universal">> = {}): OperationsAsset[] {
    if (!this.repository.getBrand(companyId)) throw new Error("企业不存在");
    if (paths.length < 1 || paths.length > 100) throw new Error("一次请选择 1 到 100 张图片");
    // Validate the complete selection before creating any record or physical copy.
    const validated = paths.map(path => {
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`图片无法读取：${basename(path)}`);
      const size = statSync(path).size;
      if (!size || size > 20 * 1024 * 1024) throw new Error(`图片为空或超过 20MB：${basename(path)}`);
      const bytes = readFileSync(path); let dimensions;
      try { dimensions = imageSize(bytes); } catch { throw new Error(`图片无法读取：${basename(path)}`); }
      const format = formats[dimensions.type ?? ""];
      if (!format || !dimensions.width || !dimensions.height) throw new Error(`不支持此图片格式：${basename(path)}`);
      if (dimensions.width * dimensions.height > 100_000_000 || Math.max(dimensions.width, dimensions.height) > 20000) throw new Error("图片尺寸过大");
      return { path, bytes, format, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    mkdirSync(this.directory, { recursive: true });
    return validated.map(({ path, bytes, format, sha256 }) => {
      const duplicate = this.repository.listImageAssets(companyId).find(asset => {
        if (!asset.enabled || !existsSync(asset.filePath)) return false;
        return createHash("sha256").update(readFileSync(asset.filePath)).digest("hex") === sha256;
      });
      if (duplicate) return { ...this.view(duplicate), duplicate: true };
      const id = randomUUID(), filePath = join(this.directory, `${id}${format.extension}`);
      writeFileSync(filePath, bytes, { flag: "wx" });
      const asset = this.repository.createImageAsset({ ...metadata, id, brandId: companyId, name: metadata.name?.trim() || basename(path, extname(path)), filePath, originalFileName: basename(path), mimeType: format.mime, size: bytes.length, sha256 });
      return { ...this.view(asset), duplicate: false };
    });
  }
  view(asset: ImageAsset): OperationsAsset {
    let width: number | null = null, height: number | null = null;
    try { const dimensions = imageSize(readFileSync(asset.filePath)); width = dimensions.width ?? null; height = dimensions.height ?? null; } catch { /* Older missing/unreadable assets remain visible with unknown dimensions. */ }
    const articles = this.repository.listArticles({ brandId: asset.brandId ?? "" }).filter(item => item.coverAssetId === asset.id);
    const jobs = this.repository.listJobs().filter(item => item.selectedImageAssetId === asset.id);
    const latest = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { ...asset, width, height, orientation: width && height ? width === height ? "square" : width > height ? "landscape" : "portrait" : "unknown", usedByArticleCount: articles.length, usedByJobCount: jobs.length, lastUsedPlatform: latest?.platformKey ?? null,
      lastUsedAt: latest?.createdAt ?? asset.lastUsedAt,
      // Dimensions/bytes are observed; platform-specific complete size contracts remain unknown.
      platformSuitability: ["douyin", "toutiao", "weibo", "sohu_media", "website", "cnblogs"].map(platformKey => ({ platformKey, status: !width || !height ? "可能不适合" : "未知" })) };
  }
}
