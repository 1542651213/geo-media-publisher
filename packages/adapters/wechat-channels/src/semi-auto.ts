import { SemiAutoAdapter, type SemiAutoAdapterDefinition } from "@publisher/adapters-semi-auto";

const definition: SemiAutoAdapterDefinition = {
  platformKey: "wechat_channels",
  displayName: "视频号",
  category: "视频",
  officialWebsite: "https://channels.weixin.qq.com/",
  officialSources: ["https://channels.weixin.qq.com/"],
  blockingReason: "首阶段只自动准备内容并打开视频号助手，用户必须在官方页面完成上传、审核和最终发布确认。",
  capabilities: { article: false, imagePost: false, video: true, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0, maxTagCount: 10, maxVideoSize: 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false }
};

export class WechatChannelsSemiAutoAdapter extends SemiAutoAdapter {
  constructor() { super(definition); }
}
