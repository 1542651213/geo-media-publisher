# 小红书 BrowserAutomation 图文 Gate-only 设计

## 目标

在正式平台 ID `xiaohongshu` 下，把现有 ManualOnly/official_sdk 占位替换为用户自有账号的 BrowserAutomation 图文能力。第一阶段只验证登录态、账号身份、图文入口、至少一张图片、标题/正文 strict readback、必填字段、发布设置和最终发布控件发现；真实 gate-only 永远在最终提交控件前停止。

本轮不执行最终发布，不创建 Job、SubmissionIntent 或 PublishRecord，不把 gate-only 结果写为 `PublishPassed`。

## 现有架构证据

- `accounts` 是现有 canonical PlatformAccount；同一 `platformKey` 可以有多条账号记录，账号由 `accountId`/`platformAccountId` 区分。
- `PublishJob`、`SubmissionIntent` 和 `PublishRecord` 已保存账号字段；本轮不新增 schema 或 migration。
- `PlaywrightSessionManager` 的安全存储 key 是 `session:${platformKey}:${accountId}`，`BrowserAutomationAdapter` 的 active/pending session key 也是 `${platformKey}:${accountId}`。
- 现有 Publisher 和队列已经按 Job 的具体账号构建 `AccountContext`；小红书只接入已有 `AutomationAdapter` contract。
- 账号连接 IPC 可复用通用 BrowserAutomation 路径，但需要通过可选 `getAccountProfile()` 读取平台身份并回写现有 `platform_account_name`、`external_account_id`、`last_verified_at` 字段。

## 设计

### Adapter 边界

在 `packages/adapters/xiaohongshu/src/browser.ts` 实现 `XiaohongshuBrowserAdapter`，继承 `BrowserAutomationAdapter`，平台定义使用：

- `platformKey: "xiaohongshu"`
- `transport: "browser"`
- `integrationMode: "BrowserAutomation"`
- `authStrategy: "ManualSession"`
- `supportsArticle: true`
- `supportsVideo: false`
- `imagePost: true`
- `maxImageCount: 18`

保留 `index.ts` 作为包根入口和兼容导出，但不再暴露旧 ManualOnly 行为。package 增加 `./browser` export。

### 真实 DOM 流程

Adapter 的 `preparePublish` 严格按以下顺序执行：

1. 验证文章标题、正文和至少一张图片；
2. 使用 account-specific BrowserSession 打开小红书创作中心；
3. 读取稳定平台账号身份信号：用户主页链接、外部账号 ID、昵称；缺少唯一身份时 fail-closed；
4. 读取页面安全验证信号，检测到验证码、滑块、短信、二维码重新登录、实名或风控即暂停；
5. 通过 href、文本、aria-label、role 等多信号唯一识别图文入口，禁止误入视频入口；
6. 通过真实 `input[type=file]` 上传第一张图片，等待可见预览、加载完成且无 loading/failed 信号；
7. 通过语义属性和结构信号唯一识别标题输入节点；
8. 写入标题并读取实际节点值，经过统一化后 equality；
9. 通过 `textarea`/`contenteditable`/富文本结构唯一识别正文节点；
10. 写入正文并读取实际节点值，经过统一化后 equality；
11. 检查所有可见 enabled required 字段为已填；
12. 读取发布设置控件和状态，输出每项 `REQUIRED`/`OPTIONAL`/`UNKNOWN`，不修改营销标签或设置；
13. 唯一识别可见 enabled 的“发布/发布笔记/提交”候选，同时记录是否有二次确认；只返回证据，不点击。

标题和正文的规范化只处理 NFKC、CRLF/LF、首尾空白和零宽字符；不使用 `includes` 作为通过条件。

### 账号身份回写

`getAccountProfile()` 从当前 account-specific page/session 返回 `AccountProfile`，优先外部稳定 ID，其次昵称与 profile URL 只放在 gate evidence。共享 IPC 在 BrowserAutomation 登录成功后调用该方法，并用已有 Repository `syncBrowserPlatformAccount` 回写 `accountName`、`externalAccountId` 和 `browserSessionId`。没有可靠外部 ID 时传 `null`，绝不从 hash、URL 猜测 ID。

### 多账号隔离

不修改 SessionManager。所有小红书 Adapter 调用都以 `{ platformKey: "xiaohongshu", accountId: ctx.accountId }` 获取 session。测试使用两个独立的 session manager doubles，验证 A/B 路由、不存在账号不 fallback、A 失效不切换 B。

### Gate-only runner

新增 `scripts/v142-xiaohongshu-gate-only.mts`，沿用现有 Electron `app.whenReady()`、production `userData`、安全凭据、Repository、Runtime Registry 组合方式。runner 只调用：

- `registry.getForContent("xiaohongshu", "article")`
- `adapter.checkLogin(context)`
- `adapter.getAccountProfile(context)`
- `adapter.preparePublish(context, article)`

runner 不调用 Publisher、`prepareSubmissionIntent`、`createArticlePublishJob`、任何 `finalSubmit`/`collectPublishResult`，也不写发布表。结果写入 `output/v142-xiaohongshu-gate-only.json`，必要时写 account-specific screenshot。当前登录账号通过显式环境变量 `XIAOHONGSHU_ACCOUNT_ID` 选择；缺失或不匹配时安全失败并记录 `ACCOUNT_SESSION_NOT_FOUND`，不选择第一个账号。

测试内容使用用户指定标题/正文，其中标题时间由脚本启动时按 Asia/Shanghai 生成；图片从 Repository 的现有 SELF_TEST/通用 fixture 选择，不联网下载。

## 错误与证据

Adapter 使用已有 `BrowserAutomationError`/`ErrorCode`，新增平台内部 gate code 仅放 response/error evidence，不扩展共享 ErrorCode，映射如下：

- 登录未通过：`LOGIN_REQUIRED`（对外使用 `LOGIN_EXPIRED`/`USER_ACTION_REQUIRED`）
- 安全验证：`SECURITY_VERIFICATION_REQUIRED`（对外 `USER_ACTION_REQUIRED`）
- 身份不唯一：`ACCOUNT_IDENTITY_UNVERIFIED`（对外 `USER_ACTION_REQUIRED`）
- 图片无预览或仍 loading：`IMAGE_UPLOAD_NOT_VERIFIED`（对外 `UPLOAD_FAILED`）
- 标题/正文 readback：`CONTENT_TITLE_NOT_VERIFIED` / `CONTENT_BODY_NOT_VERIFIED`（对外 `CONTENT_REJECTED`）
- 最终控件不唯一或不可确认：`FINAL_SUBMIT_CONTROL_NOT_VERIFIED`（对外 `FINAL_SUBMIT_CONTROL_NOT_FOUND`）

任何异常都停止后续步骤；`finalSubmitClickCount` 固定为 0。真实 runner 的最终 READY 只在所有 gate 满足时输出 `XIAOHONGSHU_READY_FOR_REAL_SELF_TEST = YES`，但 `PublishPassed` 固定为 `NOT_PASS`。

## 测试策略

- Adapter 单测覆盖登录成功/失效、身份、图文入口、视频入口排除、图片上传成功/失败、标题/正文发现与歧义、strict readback、必填字段、发布设置、最终控件发现、二次确认、security 阻塞和不点击发布。
- BrowserSessionManager 现有复合 key 测试补充两个账号同时打开和不存在 key 不 fallback 的断言。
- Registry 测试确认小红书 article 路由是 BrowserAutomation、video 不支持，平台 ID 仍唯一为 `xiaohongshu`。
- IPC/Repository 单测确认 Browser profile 摘要回写现有字段，缺失 external ID 不猜测。
- runner 静态/fixture 测试确认不调用 Publisher/Job/Intent/Record API，并固定 final submit count 为 0。
- 完成后执行 focused Xiaohongshu tests、`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。真实 gate-only 仅在 owner 已登录并明确选择账号后执行。
