import { BrowserAutomationAdapter, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";

const definition: BrowserPlatformDefinition = {
  platformKey: "weibo",
  displayName: "新浪微博",
  category: "内容/社交",
  officialWebsite: "https://weibo.com/",
  developerPortal: "https://open.weibo.com/",
  backendUrl: "https://weibo.com/",
  officialSources: ["https://weibo.com/", "https://open.weibo.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "官方 API/CLI 命令合同尚未在本地完成审阅，当前保留用户自有账号 Browser Automation 方案；真实发布不在本阶段自动执行。",
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 200, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false }
};

export class WeiboBrowserAdapter extends BrowserAutomationAdapter {
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }
}
