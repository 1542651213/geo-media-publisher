# 技术架构

## 1. 总体架构

```text
Electron Desktop
│
├─ Renderer (React)
│  ├─ Dashboard
│  ├─ AI Creation
│  ├─ Content Library
│  ├─ Brand Center
│  ├─ Account Center
│  ├─ Publish Center
│  ├─ Analytics
│  └─ Settings
│
├─ Main Process
│  ├─ IPC
│  ├─ Scheduler
│  ├─ Job Queue
│  ├─ Account Manager
│  ├─ AI Engine
│  ├─ Image Engine
│  ├─ Publisher
│  └─ Security
│
├─ SQLite
│
└─ Platform Adapters
   ├─ test
   ├─ baijiahao
   ├─ zhihu
   ├─ xiaohongshu
   ├─ toutiao
   └─ ...
```

## 2. 推荐目录

```text
/
├─ apps/
│  └─ desktop/
│     ├─ src/
│     │  ├─ main/
│     │  ├─ renderer/
│     │  ├─ preload/
│     │  └─ shared/
│     └─ package.json
├─ packages/
│  ├─ db/
│  ├─ domain/
│  ├─ ai/
│  ├─ image/
│  ├─ scheduler/
│  ├─ publisher/
│  ├─ adapters/
│  │  ├─ core/
│  │  ├─ test/
│  │  ├─ baijiahao/
│  │  ├─ zhihu/
│  │  └─ ...
│  ├─ security/
│  └─ logger/
├─ docs/
├─ tests/
├─ AGENTS.md
└─ package.json
```

## 3. PlatformAdapter 约定

```ts
export interface PlatformAdapter {
  readonly platformKey: string;

  getCapabilities(): PlatformCapabilities;

  checkLogin(ctx: AccountContext): Promise<LoginStatus>;

  beginLogin(ctx: AccountContext): Promise<LoginSession>;

  publishArticle(
    ctx: AccountContext,
    article: PublishArticleInput
  ): Promise<PublishResult>;

  validateArticle?(
    article: PublishArticleInput
  ): Promise<ValidationResult>;
}
```

Capabilities 示例：
- article
- imagePost
- video
- coverImage
- tags
- categories
- scheduledPublish
- draft
- markdown
- richText
- maxTitleLength
- maxImageCount

## 4. 发布引擎

Publisher 不知道任何具体平台页面结构。

```text
JobQueue
  ↓
Publisher
  ↓
AdapterRegistry.get(platformKey)
  ↓
PlatformAdapter.publishArticle()
  ↓
PublishResult
  ↓
更新 Job / ArticleUsage / PublishRecord
```

## 5. 调度器

调度器负责：
- 读取发布计划
- 生成任务
- 控制平台并发
- 控制账号并发
- 控制最小间隔
- 失败重试
- App 重启恢复

严禁使用只存在于内存中的定时器作为唯一任务来源。

## 6. 浏览器自动化

推荐 Playwright。

原则：
- 每个账号独立 BrowserContext
- 会话持久化
- 账号级锁
- 不共享敏感登录状态
- 遇验证码/安全验证转人工
- 不绕过安全措施
- 所有 selector 与页面流程限定在对应 Adapter

## 7. AI Provider

统一接口：

```ts
interface AIProvider {
  generateTitles(input: TitleTask): Promise<string[]>;
  generateArticle(input: ArticleTask): Promise<GeneratedArticle>;
  rewriteForPlatform(input: RewriteTask): Promise<GeneratedArticle>;
}
```

支持 Provider 配置，业务层不绑定具体厂商。

## 8. Image Provider

```ts
interface ImageProvider {
  generateCover(input: CoverTask): Promise<GeneratedImage>;
}
```

同时支持模板封面与企业素材库匹配。

## 9. 安全

- API Key 使用系统安全存储/加密存储
- Cookie/StorageState 加密保存
- Renderer 不直接读取敏感配置
- IPC 白名单
- 禁用 Node Integration
- 开启 contextIsolation
