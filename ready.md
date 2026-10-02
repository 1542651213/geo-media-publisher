# Geo Media Publisher · R1.15-G Candidate

当前状态：**R1_15_G_PARTIAL_READY**。本轮实现、232 文件 / 1671 测试、构建、隔离安装及员工完整路径已完成。真实关闭副本的凭据解密为 **21/26 成功、5 失败，原因未确认**；保留失败副本，原凭据未改写，不能把本包标为正式 Release 或承诺所有账号可用。

## 当前能力与安全边界

应用版本 1.1.9，交付标识 R1.15-G。抖音、康一官网 OfficialAPI、头条普通链路保持 ON；其他平台门禁沿用 C/D/E/F，全部 batch OFF。草稿、导入和 AI 队列仍只创建本地 Draft；修改后须重新审核，发布继续经过原持久化 Job 链路。

本轮真实发帖、最终提交、平台媒体/远端草稿写入、产品外部 AI API 请求、生产数据写入及真实账号归属确认均为 **0**。原生产目录 2599 个文件逐文件 SHA256 前后相同。未 public push、未 merge main、未改变可见性。

## Owner 回来后的四步

1. 保留升级前完整关闭副本和 F 安装包，先核对 5 条无法解密的凭据；原因尚未确定，不自动清理或重加密。当前 Candidate 的生产升级未执行。
2. 在「内容运营 → Owner 处理」核对 **28 个未确认账号**：8 个唯一历史建议、3 个冲突、17 个无证据。先选顶部真实企业工作区，再逐项确认；本轮真实归属修改数为 0。完整账号清单只在仓库外受限目录，手机索引仅含匿名序号。
3. 按平台正常流程登录或安全更新指定凭据，再检查真实重启后的账号身份。企业确认、DB logged_in 和普通能力 ON 均不能替代身份验证。
4. 真实云生成、上传、远端草稿及最终发帖须另行明确授权；当前没有这些验收结果。

## 安装身份

- 源码目录：D:/GEO_MEDIA_PUBLISHER_FINAL/source/geo-media-publisher。F 起点 d00b5d60c75e2d121986f6b1c0679ce64c97e9f1，C/D/E/F 祖先和原标签保留，未回退 origin/main。
- 包内运行时代码：**770c22e1087e4f506eb4b3c2e25095df47e33373**；源码标签 r1.15-g-package-source-v3-20261003。侧栏及「设置 → 关于此版本」显示交付标识、源码和实际构建时间 2026-10-02T17:20:58.821Z。
- 安装包：[Geo Media Publisher Setup 1.1.9 - R1.15-G HARDENING CANDIDATE.exe](<output/r115-g-package-770c22e/Geo Media Publisher Setup 1.1.9 - R1.15-G HARDENING CANDIDATE.exe>)，**101296155 bytes**，未签名。
- Installer SHA256：2017ea5acdcbc6018e6ea9d701b68d5cdb75c5d173f5696f47f9ec402d43c55b。
- 安装后 app.asar SHA256：ec7fc554fea381c9295c04c9aeb07a0afda007ea924bbed7a90447a2a0108588。Main / preload / renderer / CSS / closed worker / 37 个 migration / PLATFORMS.csv 字节一致，包内无业务 DB、凭据或验收 grants。
- 隔离安装目录：output/r115-g-isolated-install-770c22e；真实原软件和 E/F 安装包均未覆盖。
- 本地最终标签：r1.15-g-hardening-onboarding-candidate-20261003；最终文档 HEAD 用 git rev-parse r1.15-g-hardening-onboarding-candidate-20261003^{commit} 查询。包后仅有截图验证脚本提交 ab1063d 和交接文档；没有遗漏的运行时代码。

## 操作、恢复与证据

- [手机图文预览与匿名 Owner 清单](output/r115-g-phone-preview-770c22e/index.html)：8 张实际安装版合成截图，390 / 760 px 检查通过。
- [G 验收矩阵及限制](docs/releases/R1.15-G-READY.md) · [脱敏证据](docs/evidence/r115-g-verification.json) · [恢复 checkpoint](docs/releases/R1.15-G-CHECKPOINT.md)。
- [账号整理](docs/product/account-onboarding.md) · [草稿恢复](docs/product/draft-recovery.md) · [备份及资料包](docs/product/backup-restore.md) · [员工最短操作](docs/product/operator-quickstart.md)。

完整快照在独立本地进程确认 Main 退出后复制整个 userData，完成清单和 SQLite 校验才标 Complete。恢复只到新的隔离目录，并在内容落盘前设置暂停标记；不会覆盖原库或重跑 Unknown。私有凭据副本部分解密失败与合成快照恢复 PASS 分开记录。回退演练为合成 F33→G37→F33，旧软件未打开 G 数据库。

本地 Git bundle 的源码标签恢复通过；私有备份与 bundle 仍在本机，异机备份未配置。实体 Windows DPI、硬件中文输入法、跨 Windows 用户迁移、真实登录和云调用未验收。性能数据集 3000/1000/10000，发布看板仍需 4.511–4.698 秒；不声称秒开。

## 保留的历史

[F 时点完整 READY 原文及 C/D/E 历史](docs/releases/R1.15-F-READY-ARCHIVE.md) 保持 F:ready.md 的原始 blob 07a047f65616c9c84ecf1968e6e8d9aeb9438105。历史状态没有改为全绿。当前任务交接后停止；未安排自动续跑或下一平台工作。
