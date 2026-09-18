import { BrowserAutomationAdapter, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";

const definition: BrowserPlatformDefinition = {
  platformKey: "qq_public",
  displayName: "企鹅号",
  category: "图文/内容",
  officialWebsite: "https://om.qq.com/",
  backendUrl: "https://om.qq.com/",
  officialSources: ["https://om.qq.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "仅对用户自有账号提供浏览器 Session 和后台任务准备；平台资质、真实提交和回查仍需账号所有者确认，系统不模拟未授权用户。",
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false }
};

export class QqPublicBrowserAdapter extends BrowserAutomationAdapter {
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }
}
