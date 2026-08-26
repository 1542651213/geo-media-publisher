# Codex 执行 Prompt

## Prompt 0：初始化仓库

你现在是这个项目的主开发工程师。先完整阅读根目录 README.md、PRD.md、ARCHITECTURE.md、DB_SCHEMA.md、UI_SPEC.md 和 AGENTS.md。

目标：
1. 创建 Electron + React + TypeScript monorepo。
2. 开启 TypeScript strict。
3. 建立 apps/desktop 与 packages/* 目录。
4. 接入 SQLite + Drizzle ORM。
5. 建立 migration 系统。
6. 创建基础 IPC 安全层。
7. 创建左侧导航和所有一级页面占位。
8. 创建 PlatformAdapter、AIProvider、ImageProvider 接口。
9. 创建 TestPlatform adapter。
10. 加入 lint、typecheck、unit test。
11. 写 README 启动方式。

要求：
- 不实现任何真实平台。
- 不允许敏感配置进入 Renderer。
- 每一步保持程序可运行。
- 完成后运行全部 lint/typecheck/test。
- 输出：实现摘要、文件清单、运行命令、测试结果、下一步建议。

## Prompt 1：品牌知识库

实现品牌中心和品牌知识库。

要求：
- 品牌 CRUD
- 企业资料
- 服务区域
- 优势
- 联系方式
- 证书/资质文本
- FAQ
- AI 禁止编造项
- 品牌素材上传元数据
- SQLite 持久化
- React 页面
- IPC 安全访问
- 单元测试

验收：
创建“康一环保”后，重启应用，数据仍存在。

## Prompt 2：城市关键词扩展

实现关键词扩展模块。

输入：
- 品牌
- 省
- 多个城市
- 多个关键词模板

支持 `{城市}` 占位符。
生成后去重并进入 keyword_items。

提供预览与总量统计。

测试案例：
江苏 13 个城市 × 8 个模板 = 104 个组合，去重结果应正确。

## Prompt 3：AI 批量文章生成

实现 AIProvider 抽象与批量文章生成任务。

先提供 MockAIProvider，确保系统无需真实 API Key 也能测试完整流程。

功能：
- 任务创建
- 批量生成
- 并发限制
- 失败重试
- 状态进度
- 文章入库
- provider/model 记录
- 内容指纹
- 品牌知识注入
- 禁止编造规则注入
- 任务中断后恢复

不要先绑定单一 AI 厂商。

## Prompt 4：封面系统

实现 ImageProvider 抽象。

提供：
- MockImageProvider
- 模板封面生成
- 封面任务记录
- 文章与封面关联
- 平台级封面 variant

后续真实图片模型应只需新增 Provider。

## Prompt 5：发布引擎

实现持久化发布队列。

要求：
- publish_plans
- publish_jobs
- publish_records
- scheduler
- retry
- crash recovery
- account lock
- platform concurrency
- account concurrency
- NeedsUserAction 状态

使用 TestPlatform 完成端到端测试：
生成文章 → 排期 → 执行 → 成功记录。

## Prompt 6：内容复用策略

实现五种策略：
1. 发布后禁止复用
2. 同平台不重复
3. 同平台不同账号可复用
4. 完全复用
5. 复用前 AI 改写

写完整单元测试。

## Prompt 7：第一个真实平台

在开始真实平台前：
1. 研究该平台是否存在官方发文 API / 开放能力。
2. 如果存在，优先使用官方能力。
3. 如果没有，再评估用户授权下的浏览器自动化。
4. 遇验证码、安全验证、扫码确认必须转人工，不绕过。

为该平台新建独立 Adapter 包。
不得修改其他平台 Adapter。
必须提供独立测试和人工验收步骤。
