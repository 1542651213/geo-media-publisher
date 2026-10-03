# Geo Media Publisher · R1.15-H.1 UI Candidate only

当前 UI durable state：**R1_15_H1_PURPLE_UI_POLISH_CANDIDATE_READY_FOR_OWNER_REVIEW**（本地验收通过，最终安全同步回执随 Candidate 交付）。**Owner visual approval required；当前 production/main 功能基线仍为 H Candidate，MAIN_MERGED = NO。**

- 分支 `release/2026-10-03-r1.15-h1-ui-purple-product-polish`；Candidate Tag `r1.15-h1-ui-purple-polish-candidate-20261003`，HEAD 由 `tag^{commit}` 唯一解析。包内源码 `34004b070d3f53986d71e2255015625be76da8d1`。
- 紫色 Design Tokens、深紫灰侧栏、中性阅读区、字号/按钮/状态/表单/弹层、首页层级、账号/归属、发布/Owner、AI/Jobs、备份/About 已统一；保留全部发布安全语义。
- 最终 241 文件 / 1704 测试、typecheck、lint、build、package、独立安装员工 18 阶段均 PASS；11 页面 × 9 窗口/缩放共 99 检查，以及员工流程状态 99 检查 PASS。真实 Windows DPI / 硬件 IME：NOT_RUN。
- [手机 BEFORE/AFTER 预览](docs/product/R1.15-H1-PHONE-PREVIEW.md) · [UI Review](docs/product/R1.15-H1-UI-REVIEW.md) · [Candidate installer / HTML ZIP](https://github.com/1542651213/geo-media-publisher/releases/tag/r1.15-h1-ui-purple-polish-candidate-20261003) · [脱敏证据](docs/evidence/r115-h1-ui-verification.json)。
- Main/shared/domain/db/adapter/policy 360 文件未变，478 IPC 调用及参数相同；965 原 CSS selector 顺序保留。Production 2599 文件 SHA256 无变化。真实发布、final submit、远端写、云 AI、production 写入均 0；ALL BATCH = OFF。
- SECRET_SCAN：PENDING_FINAL_SOURCE_COMMIT_SCAN；安装包完整解包已 PASS，0 secret / 0 敏感路径。安装包 **NotSigned**，未配置正式签名，保留默认 Electron 图标。
- H 已有的 28 账号归属、2 个缺失历史素材、5 条 retired credential、production upgrade 与 Jobs 冷路径 P95 限制不变。下面完整保留 H handoff。
- **NEXT ACTION：Owner 在手机审阅 11 组对比及 Candidate；视觉批准后再单独决定是否合并 main。**

---

# Geo Media Publisher · R1.15-H Candidate

当前 durable state：**R1_15_H_PARTIAL_BACKUP_REVIEW_REQUIRED**。开发、1698 项回归、构建、隔离安装和员工全流程已完成。5 条无法解密的凭据已分类为同一退役 `kangyi_website` 账号的历史字段，当前能力依赖未知数为 **0**；原密文保持不变。

保留 Candidate 的原因：原生产关闭副本含 **3 条历史测试素材记录，引用 2 个已缺失的外部图片文件**。完整素材快照校验正确阻断，不能宣称完整私有恢复 PASS。另行完成的数据库升级、重启与独立回滚 PASS，不掩盖此限制。原生产尚未升级。

## 当前身份

- 长期分支：`main`。最终交付 HEAD 以 `r1.15-h-production-readiness-candidate-20261003^{commit}` 为唯一解析值；它与 main 交付提交相同。完整 SHA 与远端核验结果记录在本轮最终同步回执。文档自身不嵌入自指的提交哈希。
- 最终 Tag：[r1.15-h-production-readiness-candidate-20261003](https://github.com/1542651213/geo-media-publisher/releases/tag/r1.15-h-production-readiness-candidate-20261003)。从 G `214849bb677e6e3cab8b3dae11010d4a62df450c` 继续，保留 C/D/E/F/G 全部祖先及历史标签。
- 应用 1.1.9 / R1.15-H；包内源码 **fa54951e874aa5e38eaf12d2ed38b930e9515e88**，构建时间 `2026-10-02T20:00:24.435Z`。之后只改验收脚本、文档与生成目录的 lint 排除规则，运行时代码与已验收包一致。
- 安装包：[Geo Media Publisher Setup 1.1.9 - R1.15-H READINESS CANDIDATE.exe](<output/r115-h-package-fa54951/Geo Media Publisher Setup 1.1.9 - R1.15-H READINESS CANDIDATE.exe>)（本机路径），**101299540 bytes / NotSigned**。
- Installer SHA256：`5546228947ba27c3401c1a82761398057b11c3e4a137664a0047fb675904629c`；安装后 app.asar：`7d24394e58ded1427badf1c68246ff5e64f21612c4275074f38673937a109b34`。

## 已验证能力与限制

| 项目 | 当前结果 |
| --- | --- |
| Credential | 私有副本及实际 G→H→G Main 均 21 PASS / 5 FAIL；5 条为 LEGACY_UNUSED / RETIRED，底层解密原因未能确定，未修复、删除或重写 |
| Owner 归属 | 一页逐项确认、证据和筛选通过合成安装验收；真实 **28 UNASSIGNED**，7 MEDIUM / 1 LOW / 3 CONFLICT / 17 NO_EVIDENCE，自动确认 0 |
| 私有升级/回滚 | 完整关闭目录逐文件哈希匹配；迁移记录 44→45→44，80 张业务表一致，integrity/FK PASS；完整缺失素材恢复仍 BLOCKED |
| Scheduler / Session | 正常 Scheduler 参与隔离测试；离线、CHECKING、企业变化、generation 替换、停用、迟到响应及重启保护 PASS |
| 草稿 / AI | 自动保存、冲突选择、审核失效、冻结记录保护、取消/Unknown 不重放 PASS；20×6 预览为 140 项 / 最多 560 请求，共享并发 1；均为本地 mock |
| Jobs 性能 | 热切换 median/P95 **646/857→213/326 ms**；冷路径 **1231/4902→976/4855 ms**，冷尾延迟未解决；查询 4629→124，IPC 约 10 MB→0.60 MB |
| Backup / Colleague | 合成完整快照校验及惰性隔离恢复 PASS；同事资料包审核保护和导入后重新核准 PASS；真实私有完整素材门禁仍受阻 |
| 安装与界面 | 实际 NSIS 隔离安装、18 项员工路径、单实例/启动崩溃恢复 PASS；11 张真实合成截图，99 项窗口/应用缩放检查，390/760 px 手机索引 PASS |
| 验证 | 240 文件 / **1698 测试 PASS**；typecheck、lint、build、package PASS；包内 38 个源码 migration 与构建字节一致 |

当前正式普通发布能力仍为 **抖音、康一官网 OfficialAPI、今日头条 ON**；其他平台门禁保持，所有 batch **OFF**。能力开启不等于账号已登录、企业归属已确认或本轮完成了真实发布验收。

本轮真实发帖、final submit、远端草稿/媒体写入、产品外部 AI 请求、生产数据写入、真实企业归属确认均 **0**。原生产目录 **2599 个文件 SHA256 前后相同**。PUBLIC 同步仅含扫描通过的源码、测试、脚本和脱敏文档；私有副本、凭据、备份和原始证据不上传。安装包走既有 GitHub prerelease 资产流程，不进入 Git 源码历史。

## Owner 回来后的 NEXT ACTION

1. 先查看 [备份限制与恢复步骤](docs/operations/backup-restore.md)，核实缺失的历史测试素材，或另行授权处理明确无用的测试记录，再重新通过完整私有快照校验。不要直接覆盖原 production 或用旧程序打开 H 库。
2. 查看 [5 条凭据分类](docs/security/credential-recovery-classification.md)，保留退役字段；无需为追求 26/26 强行重加密。
3. 在「内容运营 → Owner 处理」逐项确认 28 个账号真实企业归属；冲突和无证据项可保留未确认。按正常流程登录微博、搜狐 Creator，安全更新需使用的博客园 PAT，并核验实际账号身份。
4. 配置受控异地备份目标和正式代码签名。硬件 IME、真实 Windows DPI、跨用户解密及异机恢复均尚未验证。真实平台写入与云生成另行授权。

[H 验收与完整报告](docs/releases/R1.15-H-READY.md) · [脱敏证据](docs/evidence/r115-h-verification.json) · [checkpoint](docs/releases/R1.15-H-CHECKPOINT.md) · [员工操作路径](docs/product/operator-quickstart.md) · [Jobs 性能](docs/performance/jobs-page.md) · [本机手机图文预览](output/r115-h-phone-preview-fa54951/index.html)。

[G 时点 READY 原文](docs/releases/R1.15-G-READY-ARCHIVE.md) 与 [F 时点及 C/D/E 历史](docs/releases/R1.15-F-READY-ARCHIVE.md) 保留。未安排自动续跑或新平台工作。