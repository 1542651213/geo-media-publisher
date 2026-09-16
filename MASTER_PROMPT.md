# 给 Codex 的第一条总 Prompt

请把这个仓库当成一个长期维护的正式 Windows 商业软件项目，而不是一次性 Demo。

先阅读：
- AGENTS.md
- PRD.md
- ARCHITECTURE.md
- DB_SCHEMA.md
- UI_SPEC.md
- MILESTONES.md
- PLATFORMS.csv
- CODEX_PROMPTS.md

然后只执行 M0，不要提前实现任何真实平台。

目标：
创建一个可运行的 Electron + React + TypeScript Windows 桌面应用骨架，包含：
- monorepo
- SQLite + migration
- 安全 IPC
- 左侧菜单与页面布局
- domain 类型
- PlatformAdapter
- AIProvider
- ImageProvider
- TestPlatform
- Job Queue 的最小骨架
- lint / typecheck / test
- Windows 本地启动说明

约束：
- TypeScript strict
- 不使用 any 逃避类型问题
- 不把敏感数据暴露给 Renderer
- 不实现任何绕过验证码、安全验证或风控的代码
- 平台逻辑必须完全隔离
- 所有未来发布任务都必须基于持久化队列
- 不要一次写完整产品
- 小步实现，确保每一步可运行

完成后：
1. 运行 lint
2. 运行 typecheck
3. 运行 test
4. 启动应用验证
5. 输出本次修改文件清单
6. 输出执行结果
7. 输出 M1 前仍缺少什么
