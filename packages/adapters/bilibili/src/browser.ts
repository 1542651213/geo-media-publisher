import { BrowserAutomationAdapter, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";

const definition: BrowserPlatformDefinition = {
  platformKey: "bilibili",
  displayName: "哔哩哔哩",
  category: "视频/专栏",
  officialWebsite: "https://www.bilibili.com/",
  developerPortal: "https://member.bilibili.com/",
  backendUrl: "https://member.bilibili.com/platform/home",
  officialSources: ["https://www.bilibili.com/", "https://member.bilibili.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "首阶段完成用户自有浏览器 Session、创作中心打开和发布任务准备；视频/专栏最终提交与回查仍需用户确认平台正常流程。",
  capabilities: { article: true, imagePost: true, video: true, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, maxVideoSize: 2 * 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false }
};

export class BilibiliBrowserAdapter extends BrowserAutomationAdapter {
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }
}

