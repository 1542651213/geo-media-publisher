# AI 多平台自媒体发布系统 — Codex 项目启动包

本项目目标：开发一个 Windows 桌面应用，用于企业品牌知识库管理、城市关键词扩展、AI 批量文章生成、AI 封面生成、多平台多账号管理、自动排期、自动发布、失败重试、发布回查、备份与数据统计。

## 推荐技术栈

- 桌面端：Electron + React + TypeScript
- UI：React + TypeScript
- 本地数据库：SQLite
- ORM：Drizzle ORM（或 Prisma，二选一；建议 Drizzle）
- 浏览器自动化：Playwright
- 任务队列：本地持久化 Job Queue
- AI：通过可配置 AI Provider 层接入
- 图片：通过可配置 Image Provider 层接入
- 日志：结构化日志 + 本地日志文件
- 配置：本地加密配置存储
- 打包：electron-builder

## 第一版目标

第一版最终覆盖截图中的全部平台，但采用“分批接入、逐个平台验收”的方式开发。平台能力统一通过 `PlatformAdapter` 接口实现，不允许平台逻辑侵入业务层。

## 建议开发顺序

1. 完成桌面应用骨架、数据库、基础页面
2. 完成品牌知识库与素材库
3. 完成城市关键词扩展
4. 完成 AI 批量文章生成
5. 完成 AI 封面生成
6. 完成文章库和内容复用策略
7. 完成发布队列、定时任务、失败重试
8. 完成 TestPlatform 模拟平台
9. 逐个平台实现真实 PlatformAdapter
10. 完成统计、日志、升级与备份

## 重要约束

- 不能实现绕过验证码、安全验证、风控或平台限制的功能。
- 如果平台要求用户登录、扫码、验证码或人工确认，应暂停自动流程并提示用户完成正常验证。
- 优先使用平台官方 API / 开放能力；没有官方 API 时，浏览器自动化应严格遵守平台规则和用户授权。
- 每个真实平台适配器必须可独立维护与测试。

## V0.4 本地运行

在 Windows PowerShell 中：

```powershell
pnpm install
pnpm dev
```

首次开发启动会通过正式 migration 初始化 SQLite，并写入开发种子：康一环保、8 个关键词模板、平台目录、TestPlatform 和 3 个测试账号。数据库与日志保存在 Electron 的 `app.getPath("userData")` 目录中；AI Key、微信公众号 AppSecret 等凭据由 Electron 主进程通过 `safeStorage` 加密保存，Renderer 只看到配置状态。

常用质量检查：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:stress
pnpm installer
```

`pnpm test:stress` 使用本地 TestPlatform，不向任何真实平台发送压力请求，模拟 10,000 篇文章、500 个账号和 50,000 个 Publish Job。`pnpm installer` 生成 Windows x64 NSIS 安装包，输出到 `release/`。

当前闭环为：品牌资料 → 城市关键词 → Mock/真实 OpenAI-compatible AI → Quality Gate 与禁止编造后置检查 → 模板/真实图片 Provider → 封面 → 文章库 → 平台变体 → 发布计划 → SQLite Job Queue → dry-run/人工确认 → PlatformAdapter → Publishing 状态回查 → PublishRecord → 首页/统计更新。批量 AI 任务持久化进度、支持有限并发、取消和重启恢复；真实发布默认需要人工确认，账号 `allowAutoPublish` 默认关闭。

真实 AI 设置支持 Base URL、model、temperature、最大输出 tokens、超时、有限重试、连接测试和 token 用量记录；没有 Key 时继续使用 Mock Provider。真实图片 Provider 失败时回退模板封面。

平台真实状态见 [V0.4 平台状态](docs/V0.4_PLATFORM_STATUS.md)，研究证据见 [平台能力矩阵](docs/PLATFORM_CAPABILITY_MATRIX.md)，人工授权与验收动作集中在 [MANUAL_ACTIONS.md](MANUAL_ACTIONS.md)。V0.4 保持“本地代码通过不等于真实平台通过”：只有账号所有者授权后的真实 Dry Run、发布、external ID/URL 和状态回查证据，才能升级对应生命周期。未实现或仅支持人工操作的平台不会通过 selector、逆向接口或验证码绕过假装可用。

如需验证“非开发种子”模式，可设置 `$env:PUBLISHER_ENV="production"` 后再启动；生产模式执行 migration 并同步 `PLATFORMS.csv` 的 39 个外部平台目录，但不会写入 TestPlatform、测试账号、品牌或关键词种子。
