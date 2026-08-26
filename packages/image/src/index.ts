import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CoverTask {
  articleId: string;
  title: string;
  brandName: string;
  city: string;
  width?: number;
  height?: number;
  articleType?: string;
  platformKey?: string;
  coverPrompt?: string;
}

export interface GeneratedImage {
  provider: string;
  model: string;
  mimeType: "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  content: string | Uint8Array;
}

export interface ImageProvider {
  readonly providerKey: string;
  readonly model: string;
  generateCover(input: CoverTask): Promise<GeneratedImage>;
}

export class TemplateCoverProvider implements ImageProvider {
  readonly providerKey: string = "template";
  readonly model: string = "template-cover-v0.1";

  async generateCover(input: CoverTask): Promise<GeneratedImage> {
    const width = input.width ?? 1200;
    const height = input.height ?? 675;
    const safeTitle = input.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const safeBrand = input.brandName.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f7fb"/><rect x="56" y="56" width="1088" height="563" rx="24" fill="#ffffff" stroke="#d9e2ef" stroke-width="2"/><rect x="56" y="56" width="16" height="563" rx="8" fill="#1f6feb"/><text x="112" y="190" fill="#64748b" font-size="28" font-family="Microsoft YaHei, sans-serif">${input.city} · 企业内容</text><text x="112" y="310" fill="#152238" font-size="48" font-weight="700" font-family="Microsoft YaHei, sans-serif">${safeTitle}</text><text x="112" y="490" fill="#1f6feb" font-size="30" font-family="Microsoft YaHei, sans-serif">${safeBrand}</text></svg>`;
    return { provider: this.providerKey, model: this.model, mimeType: "image/svg+xml", fileName: `${input.articleId}-cover.svg`, content };
  }
}

export interface OpenAICompatibleImageConfig {
  providerKey?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  quality?: string;
  timeoutMs: number;
}

interface ImageResponse { data?: Array<{ b64_json?: unknown; url?: unknown }> }

function imageEndpoint(baseUrl: string): string { return `${baseUrl.replace(/\/+$/u, "")}/images/generations`; }

function buildCoverPrompt(input: CoverTask): string {
  return input.coverPrompt?.trim() || [
    `为“${input.city}${input.title}”生成一张${input.articleType ?? "企业服务文章"}封面背景`,
    "真实、克制、干净的本地服务场景，适合文章头图，不要出现任何文字、数字、Logo、商标、证书、人物身份暗示和无法验证的效果承诺",
    `品牌仅作为内容语境参考：${input.brandName}，不要在画面内生成品牌字样`,
    `平台：${input.platformKey ?? "通用"}`
  ].join("；");
}

export class OpenAICompatibleImageProvider implements ImageProvider {
  readonly providerKey: string;
  readonly model: string;

  constructor(private readonly config: OpenAICompatibleImageConfig) {
    this.providerKey = config.providerKey ?? "openai-compatible-image";
    this.model = config.model;
    if (!config.apiKey.trim()) throw new Error("图片 Provider API Key 未配置");
  }

  async generateCover(input: CoverTask): Promise<GeneratedImage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, this.config.timeoutMs));
    try {
      const response = await fetch(imageEndpoint(this.config.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ prompt: buildCoverPrompt(input), model: this.config.model, size: this.config.size, quality: this.config.quality ?? "standard", n: 1, response_format: "b64_json" }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`图片 Provider 请求失败（HTTP ${response.status}）`);
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("图片 Provider 返回结构无效");
      const item = (payload as ImageResponse).data?.[0];
      if (typeof item?.b64_json === "string") return { provider: this.providerKey, model: this.model, mimeType: "image/png", fileName: `${input.articleId}-cover.png`, content: Buffer.from(item.b64_json, "base64") };
      if (typeof item?.url === "string") {
        const imageResponse = await fetch(item.url);
        if (!imageResponse.ok) throw new Error("图片 Provider 结果下载失败");
        return { provider: this.providerKey, model: this.model, mimeType: "image/png", fileName: `${input.articleId}-cover.png`, content: new Uint8Array(await imageResponse.arrayBuffer()) };
      }
      throw new Error("图片 Provider 未返回图片数据");
    } finally {
      clearTimeout(timer);
    }
  }
}

export class MockImageProvider extends TemplateCoverProvider {
  readonly providerKey: string = "mock-image";
  readonly model: string = "mock-image-v0.1";
}

export async function persistGeneratedImage(image: GeneratedImage, outputDir: string): Promise<string> {
  const filePath = join(outputDir, image.fileName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, image.content, typeof image.content === "string" ? "utf8" : undefined);
  return filePath;
}
