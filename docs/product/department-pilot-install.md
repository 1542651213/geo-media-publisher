# 安装与数据目录

程序与数据分开保管。R1.15-I Candidate 安装在新程序目录，使用独立安装标识，保留 H.2 和 Owner 原有软件。此轮不卸载旧软件、不覆盖原生产目录，也不验证真实生产升级。

部门入口是交付 ZIP 中的 Start-Pilot.cmd。首次选择安装目录里的 Geo Media Publisher.exe；启动器核对 SOFTWARE.json 中的实际 app.asar 摘要，不匹配就明确停止。目录链接、文件冒充目录、生产目录重叠、缺少资源或实验性验收授权也会停止。

部门新库默认位于：

    %LOCALAPPDATA%\GEO-Department-Pilot-R115I\b01-isolated-user-data

这是现有受保护隔离目录规则，目录名称不会开放 B01 验收或 batch。主库、素材、会话与凭据均按产品现有路径规则保存在此独立试用位置。首次启动没有继承企业、账号、任务或 Key；以后继续使用同一个入口和同一 Windows 用户。

已有数据电脑的普通 EXE/旧快捷方式可能指向旧数据。部门试用始终从本轮新库入口启动；在设置核对 I 身份，在入口窗口核对新库路径。不要把旧数据目录改名、移动或复制凭据给同事。卸载程序也不代表完成数据备份。

本机核验使用独立 session/log/media/temp，网络保护早于 Main，并拒绝读取源码目录，PATH 仅保留 Windows 系统目录及系统 WindowsPowerShell。平台浏览器依赖系统 Chrome，失败时尝试 Edge；不依赖开发机 Playwright 浏览器缓存。未安装这两者时本地草稿功能仍可使用，平台连接会明确提示安装系统浏览器。

完整备份关闭交接需要 Windows 自带 PowerShell；缺组件时应保留 Incomplete 提示交由 IT 处理。安装包包含 Main、Preload、Renderer/CSS、原生 SQLite、38 个 migration 文件和平台资源。应用迁移记录数可能包含历史标识，不等于文件数。

当前签名状态为 UNSIGNED，普通用户权限与独立干净 Windows 电脑验收尚未执行；现场按首日清单验证实际安装、系统浏览器、无网络状态和重启。公司安全策略阻止安装或脚本时保存提示，请 Owner/IT 核对来源与签名政策，不使用 bypass 参数或关闭防护。

路线 A：原生产升级 = PENDING_OWNER_AND_BACKUP_REVALIDATION。缺失两份历史图片还有发布历史引用，不能自动退休。

路线 B：部门新库 = 独立验证。Complete 新库快照和合成恢复不证明原库完整恢复、跨用户解密或新电脑验收。
