# GEO Media Publisher

Windows 桌面端多平台内容运营与发布工作台。项目采用 Electron、React、TypeScript、SQLite、Drizzle ORM 与 Playwright，平台能力通过独立 `PlatformAdapter` 接入。

## R67 冻结基线

R67 是当前已验收的 Xiaohongshu（小红书）发布基线，源码 tag 为 `xhs-task10s-r67`。验收包含冷启动账号会话恢复、Creator 身份校验、单次图片上传、Windows 原生文件选择框恢复、编辑器内容校验、ARM/Authorization、context-bound identity attestation、closed-shadow final-submit resolver、one-shot 提交边界，以及平台侧“已发布”确认。

| 项目 | 值 |
| --- | --- |
| Source commit | `972b665f4a0c4f88d283e2f342b6348258ca1234` |
| Release tag | `xhs-task10s-r67` |
| Windows artifact | `GEO-Media-Publisher-R67-Windows-x64.zip` |
| `app.asar` SHA256 | `3C7C16423B2319AA536518A5879A7FA98AF9FC788FE5821D1B1E2AB47B465C8D` |
| `better_sqlite3.node` SHA256 | `AFA1DCAEDFC94D399413F18662D5FDA9C7025A23BC8CEF064D2986A0CEF2F60E` |
| better-sqlite3 ABI | `136` |

已验收的真实平台动作只针对获得明确授权的测试账号与测试内容。仓库不包含生产数据库、浏览器 profile、Cookie、Token、密码、`.env` 文件或其他运行时凭据。

## Archive provenance`r`n`r`n- Original frozen local R67 commit: `972b665f4a0c4f88d283e2f342b6348258ca1234``r`n- GitHub source-only archive commit: `c428818fdd56255c07ee1893aee75675f70a5ddf``r`n- GitHub tag: `xhs-task10s-r67` points to the source-only archive commit.``r`n- Windows runnable build is distributed through the GitHub Release asset and is not stored in Git history.``r`n- `COLD_START_PASS = YES`; `PLATFORM_POST_CONFIRMED = YES`.``r`n`r`n## 快速开始

在 Windows PowerShell 中：

```powershell
pnpm install
pnpm dev
```

常用检查：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

生成 Windows x64 目录包：

```powershell
pnpm package:dir
```

运行时数据写入 Electron 的 userData 目录，与源码仓库分离。请勿把该目录、SQLite 文件、浏览器用户数据或日志复制到 Git。

## 项目结构

- `apps/desktop`：Electron 主进程、preload 与 React renderer。
- `packages/db`：SQLite schema、migration 与持久化 repository。
- `packages/platforms`：各平台 `PlatformAdapter` 及其独立测试。
- `scripts`：质量检查、迁移和发布辅助脚本。
- `docs`：架构、平台能力、操作和验收说明。

## 安全与平台边界

- 所有真实发布都必须经过持久化 Job Queue、授权和 PublishRecord。
- 平台要求登录、验证码或安全验证时，流程暂停并由账号所有者完成正常验证。
- 不实现验证码、人机验证、风控或平台限制绕过。
- 自动化失败使用有限重试并保留可审计错误状态。
- 任何新平台适配器都应包含独立测试，不修改其他平台的业务实现。

## 已知限制

平台侧可能已经明确显示内容发布成功，但 External ID 或 URL 尚未返回；此时内部 `PublishRecord` 可能暂时保持 `NeedsReconciliation` 或 `SUBMIT_RECONCILIATION_REQUIRED`。

R67 的发布说明与校验值见 GitHub Release。源码 tag 与 Release asset 应保持同一冻结基线。

