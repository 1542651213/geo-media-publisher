# GEO Media Publisher · R1.15-I 部门试用 Candidate

**当前 durable state = LOCAL_PILOT_VERIFIED_GITHUB_DELIVERY_PENDING。MAIN_MERGED = NO；Owner 首次真实使用及 H.2 视觉批准仍需现场完成。**

本轮为独立新库部门试用。原生产升级仍为 **PENDING_OWNER_AND_BACKUP_REVALIDATION**，完整私有素材恢复仍 **BLOCKED_MISSING_FILES**；新库通过不会解除原库阻塞。

- 分支 `release/2026-10-03-r1.15-i-department-pilot-handoff`；Candidate 交付标识 `r1.15-i-department-pilot-candidate-20261003`。最终交付 HEAD 使用该 `tag^{commit}` 唯一解析；公开同步正在收口。
- 包内源码 **77265ff876fbdfb32d1f5c56433590966bec8cd3**；应用 **1.1.9 / R1.15-I**。H.2 起点 **5280de63ba7b5f2bd2fbfe078e50ce6f360cc462**，保留 C/D/E/F/G/H/H.1/H.2。main/origin/main 保持 H Candidate **c2017994ef3df592fd17ffa009a56fbcca99796c**。
- 最小修复：空库通过普通 UI 创建第一家企业，仅调用原有 `brands.create`；显示准确 I 身份。保留紫色界面，Main/IPC/DB/Adapter/发布安全逻辑 **360 文件未变**。
- 最终全量 **243 文件 / 1708 测试 PASS**；focused **9 文件 / 61 测试 PASS**；typecheck、lint、build、NSIS package 与安装后资源字节核验 PASS。
- 本机管理员账户、实际 NSIS 新目录安装：**20 项员工 UI 路径 + 6 项故障检查 PASS**。合成导入为 Draft、事实人工核准；同事资料包不继承审批、账号、凭据或历史。新库 Complete 快照、校验、隔离恢复和恢复后暂停自动执行 PASS。
- 安装版拒绝源码读取，源码模块/读取均 0，无 dev server。验收控制器退出后 Main 仍运行且 UI 响应；**未关闭 Codex 客户端，未验普通 Windows 用户或另一台干净电脑**。
- 唯一部门 ZIP **41 文件 / 102660837 bytes**，已解压逐文件校验。内含安装包、Start-Pilot 新库入口、本地 HTML 说明、图解、合成模板及校验清单。无自动运行或 Owner 快捷方式；旧安装保留。实际 **NotSigned / 默认 Electron 图标**。
- 当前普通发布仍为 **抖音、今日头条、康一正式官网 OfficialAPI ON**，原门禁保持；其它平台受限，**ALL_BATCH = OFF**。真实平台网络、登录/绑定/发布和云生成未执行，全部真实写入与 GEO 外部 AI 请求 **0**。
- 原 production **2599 文件 / 字节与 SHA256 差异 0**。首批私有候选：抖音 1、头条 1、官网 2；真实 28 个账号仍待 Owner。五条 retired credential 未尝试解密或改写。
- 两份缺图对应三条素材记录。额外关联为 Job 选择字段 5 项、PublishRecord 选择字段 4 项、回执字段 4 项，**不是 13 条不同记录**。退休提案 **BLOCKED_REFERENCED_PUBLISH_HISTORY**，恢复/退休/替换均 0。9 篇原稿和 3 份存在的图片候选仅留仓库外私有位置，待 Owner 选择与审核。
- 包解包扫描 **3809 项 / 0 secret / 0 敏感路径**；部门 ZIP、表格单元格和图解扫描 PASS。最终源码/待推送历史扫描和 GitHub 图片渲染正在收口。

[唯一部门 ZIP 与 Candidate 安装包](https://github.com/1542651213/geo-media-publisher/releases/tag/r1.15-i-department-pilot-candidate-20261003) · [开始使用](docs/product/department-pilot-quickstart.md) · [首日现场检查单](docs/product/day-one-acceptance.md) · [完整 13 图员工图解](docs/product/r115-i-pilot-preview/index.md) · [离线手机可读 HTML](docs/product/r115-i-pilot-preview/index.html) · [手机预览](docs/product/r115-i-pilot-preview/phone-preview.png)。

**NEXT ACTION：明天 Owner 选定一个真实企业及首批账号，一位同事在实际普通用户/独立 Windows 电脑安装，从 Start-Pilot 新库入口导入完整资料。逐项审核后，再单独授权登录、归属与唯一一条业务发布。原库找回缺图及完整备份重验继续独立处理。**

## 本版本实际安装版精选截图

本轮新 NSIS 安装版，合成资料，**1464×895 / 100% 应用缩放**。完整图集附来源和说明；SIMULATED 任务展示单独标注。GitHub 渲染待推送后实际核验。

### 空库首页与第一家企业入口

[![空库首页 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/00-fresh-start.png)](docs/product/r115-i-pilot-preview/00-fresh-start.png)

### 合成模板导入预览

[![导入预览 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/01-import-preview.png)](docs/product/r115-i-pilot-preview/01-import-preview.png)

### 草稿自动保存

[![草稿已保存 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/03-draft-saved.png)](docs/product/r115-i-pilot-preview/03-draft-saved.png)

### 无账号发布保护

[![发布按钮阻塞 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/05-publish-blocked.png)](docs/product/r115-i-pilot-preview/05-publish-blocked.png)

### 新库账号中心

[![新库账号中心 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/07-accounts-empty.png)](docs/product/r115-i-pilot-preview/07-accounts-empty.png)

### I 包源码与版本识别

[![当前版本 · R1.15-I 安装版](docs/product/r115-i-pilot-preview/10-version.png)](docs/product/r115-i-pilot-preview/10-version.png)

[完整 I 报告与摘要](docs/releases/R1.15-I-READY.md) · [脱敏证据](docs/product/r115-i-pilot-preview/evidence.json) · [checkpoint](docs/releases/R1.15-I-CHECKPOINT.md) · [支持范围](docs/product/department-pilot-support.md) · [问题处理](docs/product/department-pilot-troubleshooting.md) · [原库备份限制](docs/operations/backup-restore.md)。

历史：[H.2 UI](docs/releases/R1.15-H2-UI-CANDIDATE.md) · [H.2 ready 存档](docs/releases/R1.15-H2-READY-ARCHIVE.md) · [H.1 UI](docs/releases/R1.15-H1-UI-CANDIDATE.md) · [H 功能 Candidate](docs/releases/R1.15-H-READY.md) · [G](docs/releases/R1.15-G-READY-ARCHIVE.md) · [F/C/D/E](docs/releases/R1.15-F-READY-ARCHIVE.md)。本轮没有合并 main 或安排自动续跑。
