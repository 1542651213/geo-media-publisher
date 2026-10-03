# 可见 UI 交付的真实截图规则

Owner 在 R1.15-H.2 要求此规则作为后续可见 UI 版本的持久交付约定。

每个可见 UI Candidate 的根 `ready.md` 必须在顶部状态后直接嵌入至少 4–6 张该版本真实安装版的脱敏关键截图，并链接完整配对图集。仅写本机 PHONE_PREVIEW_PATH、仅附外部图集或用静态 HTML mock 截图都不能替代。H.2 明确要求首页、AI Center、账号中心、历史账号归属、发布中心、Owner Center 六张。

截图使用仓库内相对路径，放在 `docs/product/<version>-ui-preview/`；完整 BEFORE / AFTER 图集另放 `docs/product`。相同 fixture / route / viewport / zoom 配对，记录包内 source identity、安装过程与截图 SHA256。保留第一轮截图，逐张视觉复查，再按实际问题精修并生成最终安装版图。

推送前逐图检查，使用合成资料；账号、联系方式、凭据、API Key、路径和 production 资料不得进入公开截图。原始隔离目录、备份及私有清单不得进入源码仓库。源码、文档、图片、预览与安装包均经过最终扫描。

推送后用真实浏览器打开 GitHub 的 ready.md Markdown 视图，检查嵌入图全部完成加载、naturalWidth 非零、没有破图，并保存当前 branch / HEAD 与渲染回执；再核对远端图片 SHA256。手机离线索引和浏览器窄宽检查作为额外证据，不能代替 GitHub 渲染检查。

UI Candidate 仍需 Owner 最终视觉批准，发布分支与 prerelease 不代表 main 已合并，也不代表 production / 真实平台 / 云 AI 已验收。
