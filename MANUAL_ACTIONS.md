# 人工操作清单

以下步骤涉及用户凭据、扫码、验证码、平台授权或真实发布确认，系统不会自动绕过，也不会因为等待它们而阻塞其他本地开发验证。

## V1.1.3 平台自测中心

1. 安装 `Geo Media Publisher Setup 1.1.3.exe`，SHA256 为 `9A8F72AD693CE9AAFB3449C58577C3E2DF8994AB94F26DE71E69FD65A9BF9CA8`。入口位于“高级功能 → 平台自测”，账号中心已有账号的平台卡片也有“自测”按钮。
2. 默认点击“自测 L1–L3”只检查账号连接/Session、打开真实编辑器、填写并回读标题/正文；它不会创建测试文章、发布 Job 或 PublishRecord，也不会点击最终发布。图片库没有合适测试图时记录 `SKIPPED_NO_TEST_IMAGE`；只有选择而没有真实上传证据时只能显示部分通过。
3. “检查全部已连接账号”只执行 L1，不批量打开编辑器。列举网按账号逐行显示并逐账号点击；即使存在 13 个账号，也不会默认批量创建草稿或发布相同测试内容。
4. “草稿测试”可能调用平台真实草稿能力；“真实发布测试”必须先显示目标平台和账号，再由用户点击“确认测试发布”。视频平台没有用户指定的本地测试视频时停在 `WAITING_FOR_TEST_MEDIA`。未经确认不得创建真实发布任务。
5. 测试内容清理只在已有可靠删除能力和 External ID 时提供，并要求第二次确认。没有可靠删除能力时保留 External URL 供用户在平台官方后台处理；不得猜测删除成功。
6. 本轮安装版真实结果：知乎账号 L1、L2、标题填充和正文填充 PASS；图片只证明已选中，未证明真实上传；L4/L5 未执行。百家号账号 `63a5c93c-e62f-4f6b-b2ae-58c1e1e01b38` 在 L1 返回 `LOGIN_EXPIRED / logged_out`，L2/L3 未执行。没有发布测试帖，也没有 External URL。
7. 用户下一步如只想复查安全链路，点击知乎行的“自测 L1–L3”。如要验证真实发布，必须单独点击知乎行的“真实发布测试”，阅读目标账号提示后再决定是否点击“确认测试发布”；本轮未替用户做该确认。

## V1.1.1 UX Fix Pack 安装后验收

1. 安装 `Geo Media Publisher Setup 1.1.1.exe`，SHA256 为 `39CC9217219A5A5332DBDA2DF6359E9A529C159AC64E1703827C58B01943A69B`。升级不会要求删除用户数据、Cookie 或加密凭据；若平台触发验证码、安全验证或人机验证，只能在官方流程中由账号所有者完成。
2. 进入“偏好设置”，确认默认内容审核为“仅提醒”。在文章库选择 Draft 或 NeedsReview 的正式运营文章，点击“发布”，确认弹窗显示提醒且“仍然发布”可用。需要恢复旧强制门禁时选择“严格审核”；选择“关闭审核”时仍应保留发布前内容预览。
3. Excel 导入仍只写文章、不自动发布。导入完成后可在文章库对该文章发起发布；默认“仅提醒”允许在确认提示后继续，最终仍经过持久化 Job Queue 和平台账号所有者确认。
4. 在“图片库”批量上传至少 3 张真实企业图片，直接为每张选择不同的业务、地区和用途，可按需添加自定义标签。发布文章时核对“自动匹配”的图片与命中原因，再点击“换一张”确认不会重复当前候选；图片语义不合适时改为手动选择或不配图。
5. 在“账号中心”确认顶部显示 39 个平台，可通过全部、已连接、常用、需处理和搜索访问完整目录。重点检查知乎仍显示“已连接”，打开后台后仍是账号所有者自己的官方 Session；不要用本地状态替代外部平台授权或登录有效性。
6. 本轮正式安装版 Smoke 已验证 UI、持久化数据、39 平台目录及知乎会话保留，但没有点击任何平台的最终发布按钮。只有获得 External ID、真实 URL 和最终状态回查后，才可评估 `PublishPassed`。

## V1.1 内容运营工作台首次使用

1. 先关闭正在运行的旧版 Geo Media Publisher，再运行 `Geo Media Publisher Setup 1.1.0.exe`。安装包 SHA256 为 `07A755911157995CCA0AE24F7B355796F0589D6D98F6A45554B64D113AF2C31B`；不要通过删除用户数据、Cookie 或应用目录来解决安装问题。
2. 打开首页，确认可以看到今日内容、待审核、待发布、已发布和在线账号。需要先补内容时点击“生成内容”；已有 Excel 时进入“文章库 → 下载模板”，只填写“标题”“内容”后再执行“Excel 导入”。
3. 在“图片库”上传企业图片，并为图片选择治理现场、检测设备、消杀现场、白蚁防治、办公环境、企业资料、证书资料或通用图片。需要精确匹配时再展开“高级标签”填写业务和城市。
4. 在“内容生产”选择企业资料，填写业务、城市、关键词和生成数量，点击“开始生成”。等待文章生成、图片匹配和内容检查完成后，到“文章库”核对内容；审核通过后才可发布。
5. 在“账号中心”连接知乎、微博、头条或抖音账号。账号所有者必须在平台官方页面自行完成登录、验证码、安全验证或人机验证；不得绕过。账号显示“已登录”后才会成为发布渠道。
6. 在文章点击“发布”，勾选渠道并核对自动选择的账号，点击“开始发布”。系统只会打开编辑页面并填写内容，最终发布由账号所有者在平台页面确认；知乎会话、最终发布 URL 和 External ID 均不因本地检查自动变为成功证据。

## V1.0.4 简易导入、图片库与一键发布

1. 安装 `Geo Media Publisher Setup 1.0.4.exe`，SHA256 为 `3E4B166BD6873064A0BE23549F48BAD6B406FE0BACC14E4D8CDE801DD993A96E`。启动后先进入“图片库”，选择 3 张图片批量导入，可填写业务（如甲醛治理）、城市（如苏州/木渎）、平台（如知乎）和标签，并确认图片处于启用状态。
2. 进入“文章库”，点击“下载简易模板”，在 `文章导入` Sheet 中只填写 `标题`、`内容` 两列，填写 2 篇后点击“Excel 导入”。检查预览中的行号、标题、状态和错误；点击确认导入后，文章应显示为 Excel 导入来源，质量状态仍需人工审核，不会自动创建发布任务。
3. 需要完整业务字段时使用“下载高级模板”。高级模板保留 12 个文章字段和 `填写说明` Sheet；简易模板与高级模板互不覆盖。
4. 对一篇质量状态为 `Approved` 的文章点击“发布到平台”。只有一个已连接账号时，系统会显示“账号：xxx（已自动选择）”；有多个账号时才需要选择。选择“自动随机配图”或手动图片，确认预览和匹配提示，再点击“打开X并填写文章”。
5. 应用会打开平台编辑器并填写文章内容，Job/PublishRecord 会记录图片选择模式和资产 ID；当前知乎图片选择已保存，但知乎编辑器的稳定自动插入仍标记为待下一步，不要把图片选择当作已插入或已发布。最终发布按钮必须由账号所有者在官方页面确认。
6. 若文章不是 `Approved`，点击“去审核”完成审核后再发布。遇到登录失效、验证码、人机验证、风控或编辑器结构变化，暂停并由账号所有者在平台正常处理。

## V1.0 Browser Automation 首批账号连接与发布边界

首批平台为知乎、百家号、新浪微博、搜狐号、企鹅号、哔哩哔哩。账号所有者在“账号管理 → 平台账号配置中心”逐个点击“连接账号”，在新开的官方浏览器窗口中自行完成登录、验证码、短信和安全验证；完成后回到应用点击“已完成登录并保存 Session”。Session 由主进程安全保存，不能把 Cookie、storageState 或任何密钥复制到聊天、日志或普通文件。

连接成功后，用户可以点击“测试连接”和“打开后台”，确认进入自己账号的官方创作中心。发布计划中选择自动发布、人工确认或仅生成时，首批 Browser Automation 平台仍只生成持久化准备任务；系统不会替用户点击最终发布按钮。遇到验证码、风控、安全验证或登录失效时，保持 Connecting / NeedsLogin / WaitingForUser，等待用户处理。

V1.0 暂不具备真实 PublishPassed 证据。若要推进真实发布，必须由账号所有者选择低风险文章，先检查内容和封面，再在平台官方页面人工确认最终提交，并保存平台返回的 External ID、文章 URL 和状态回查结果。没有这些外部证据，不得把代码测试、Dry Run、截图或本地打开后台当作真实发布通过。

## V1.0.3 知乎账号同步与 Excel 导入

1. 安装 `Geo Media Publisher Setup 1.0.3.exe`，确认应用启动；安装包 SHA256 为 `D83E249374CCFF244AB908FFBBFD3B620FF3F3E65A686FE1391F01594E8E805F`。
2. 在“账号管理 → 平台账号配置中心”选择知乎账号，点击官方登录；由账号所有者在知乎官方页面完成登录、验证码和安全验证，再点击“已完成登录”。回到“全部账号”确认同一条账号显示为 `Connected / Authorized / BrowserAutomation`。断开后应仍保留账号记录，但状态变为 `logged_out / NotAuthorized`。
3. 在“文章库”点击“下载导入模板”，模板文件名必须为 `Geo Media Publisher 文章导入模板.xlsx`。只在“文章导入”填写标题、正文及业务字段；关键词和标签用分号分隔，目标平台只表示意图，不会自动发布。
4. 点击“Excel 导入”，先检查预览中的可导入、重复、错误/未知企业计数和逐行错误；未知企业可选择已有品牌或跳过。重复默认跳过，只有明确覆盖的行才再次导入；需要时导出 CSV 错误报告。
5. 导入确认后，在文章库切换 `Excel 导入` 筛选核对来源。导入内容为 Production，但质量状态保持 Draft/unchecked，不会自动 Approved、创建 Job 或打开知乎编辑器。
6. 只有质量状态为 `Approved` 的文章才点击“发布”。弹窗核对文章标题、来源、Quality Gate、知乎账号和 `BrowserAutomation / ASSISTED`。确认后系统先写入 `AwaitingConfirmation` Job，再打开知乎编辑器并实际填充/校验标题和正文，PublishRecord 只能是 `Prepared`，不会点击最终发布。
7. 由账号所有者在知乎官方编辑器检查内容并自行决定是否点击最终发布。遇到验证码、人机验证、风控、编辑器结构变化或登录失效，停止并按提示处理；不得绕过，也不得把 `EDITOR_OPEN_PASSED` 当作 External URL 或正式发布成功。

## V0.7 微信公众号真实发布验收向导

1. 打开“账号管理 → 平台账号配置中心”，在微信公众号账号卡片点击“进入微信公众号验收向导”；需要修改 AppID/AppSecret 时返回账号中心配置，Secret 仍只保存到 Electron 主进程 safeStorage。
2. 在向导确认账号已启用、Adapter 状态为 ready、Credential 显示已配置；未配置真实 AppID/AppSecret 时不要继续。
3. 点击“连接测试”，确认真实微信公众号账号返回 `logged_in`。再点击“检查发布前环境”，确认账号、Credential、Adapter 和连接状态均通过；该操作不改变平台生命周期。
4. 选择已进入持久化发布队列的文章，完成文章检查和封面检查。文章必须有标题、正文、未失败的质量状态，并关联封面素材。
5. 点击“执行真实 Dry Run”。向导只允许执行微信公众号账号对应的持久化 Job；Dry Run 必须创建草稿并写入成功的 Dry Run PublishRecord，不调用最终发布接口。没有真实 Dry Run 证据不得填写 `DryRunPassed`。
6. 检查 Dry Run 的 PublishRecord、草稿 External ID 和返回信息，勾选账号、文章、封面和低风险范围确认，然后点击“确认并正式发布”。未勾选确认不得调用正式发布接口。
7. 正式发布后查看 PublishRecord 中的 `publish_id`，若任务处于 `Publishing` 或 `NeedsReconciliation`，点击“执行状态回查”。只有最终状态为 Published、External ID、External URL 和状态回查均成功，才能评估 `PublishPassed`。
8. 若缺少真实账号、账号所有者授权、AppID/AppSecret、草稿/素材/群发权限或真实平台响应，向导保持阻塞，微信公众号继续保持 `WaitingForUser`；不得用单元测试、本地检查或截图替代真实证据。

## V0.7.1 抖音真实发布验收向导

1. 打开“账号管理 → 平台账号配置中心”，在抖音账号卡片点击“进入抖音验收向导”；配置 Client Key、Client Secret 和 redirect URI 时，Secret 只保存到 Electron 主进程 safeStorage。
2. 在向导确认账号已启用、Adapter 为 ready、Credential 已配置；不要把 Client Secret、Access Token、Cookie 或 Authorization 粘贴到日志、文档或聊天中。
3. 点击“开始抖音官方 OAuth”，在官方页面完成授权、验证码、安全验证或应用审核要求；将完整回调 URL 粘贴回向导并完成 OAuth。Access Token 只由主进程管理和刷新，页面只显示状态。
4. 点击“连接测试 / 用户验证”，确认 Adapter 使用 `userinfo` 返回 `logged_in`；再检查 `video.create` 权限。连接测试不改变抖音生命周期。
5. 在发布计划/队列中准备该账号的 `contentKind=video` 持久化任务并绑定 `videoAssetId`，确认视频、可选封面和内容符合 Adapter 的格式、标题、描述、标签限制。
6. 点击“执行抖音 Dry Run”。当前 Adapter 的 Dry Run 是零网络本地视频参数校验（`networkCalls=0`），即使 Job 通过也不能填写真实平台 `DryRunPassed`；没有真实账号时不要继续。
7. 账号所有者检查视频和低量范围，勾选人工确认，再点击“人工确认后正式发布”。正式上传必须进入持久化 Job Queue；不要直接绕过队列调用平台。
8. 发布后检查 PublishRecord 的抖音 `publish_id`/`item_id`/`video_id` External ID；若任务处于 `Publishing` 或 `NeedsReconciliation`，点击“状态回查”，确认最终状态、External ID 和 External URL。
9. 没有真实账号、OAuth、`video.create` 权限或真实发布响应时，抖音继续保持 `WaitingForUser`；没有真实 Dry Run 不能升级 `DryRunPassed`，没有真实发布和最终回查不能升级 `PublishPassed`。

## V0.6 真实发布验收入口

验收记录统一维护在 [`docs/V0.6_VERIFICATION_PLAN.md`](docs/V0.6_VERIFICATION_PLAN.md)。当前只推进以下五个平台；未取得账号所有者明确授权前，不创建真实发布 Job，不执行外部发布：

| 优先级 | 平台 | 用户必须完成 | 验收前置条件 |
|---:|---|---|---|
| 1 | 微信公众号 | 提供有草稿、素材和群发权限的账号；配置 AppID/AppSecret；完成官方权限确认 | 登录检测通过；文章含可读封面；先 Dry Run，再人工确认真实发布 |
| 2 | Facebook Pages | 完成 Meta App Review/Advanced Access、Facebook OAuth，选择可管理 Page 并授予内容创建任务 | Page access token 由主进程安全保存；只发布 Page Feed 文本/链接；先 Dry Run，再人工确认 |
| 3 | 新浪微博 | 安装并登录官方 CLI；提供经 owner 审阅的发布与状态回查命令 contract | contract 未注入时保持 `API_REVIEW_REQUIRED`；不得猜测命令参数 |
| 4 | 抖音 | 完成开放平台应用审核、`video.create` 权限、OAuth 回调配置和账号授权 | 登录检测通过；视频/封面满足 Adapter 校验；先 Dry Run，再人工确认 |
| 5 | 哔哩哔哩 | 完成开发者审核、专栏发布权限和 OAuth；确认当前官方草稿/发布/回查端点合同 | 端点合同完成审阅并注入后才能进入真实调用；视频能力保持关闭 |

### 统一验收动作

1. 账号所有者提供脱敏账号标识，并在官方平台完成 OAuth、扫码、短信、验证码、安全验证、企业认证或应用审核；系统不代办或绕过这些步骤。
2. 在桌面端配置 Credential。AppSecret、Client Secret、Access Token、Cookie 等只进入主进程安全存储，不写入本文件、Renderer 或日志。
3. 创建或选择一篇已完成 AI provider/model/生成时间记录的内容；确认标题、正文、图片/封面符合该平台 capability。
4. 先创建持久化 Dry Run Job，确认 `PublishRecord` 记录为 Dry Run 且没有真实平台副作用。
5. 账号所有者检查预览并完成账号级人工确认；未确认的 Job 必须保持 `AwaitingConfirmation`/`NeedsUserAction`，不得自动升级。
6. 真实发布后登记 Job ID、PublishRecord ID、External ID、External URL、发布时间和状态回查结果；任何失败登记错误码和原因。
7. 只有完成真实证据后，才可在 `docs/V0.6_VERIFICATION_PLAN.md` 填写对应结果并申请从 `WaitingForUser`/`Developing` 升级；`PublishPassed` 不自动等于 `Stable`。

### 用户提交验收信息模板

请通过安全渠道提供以下非敏感信息：

- 平台与账号脱敏名称（不要提交 Secret/Token/Cookie）。
- OAuth/App Review/API 权限/企业认证是否完成，以及完成时间。
- Desktop 端账号配置是否显示“已配置”，登录检测是否通过。
- 计划用于 Dry Run 的文章标题、封面是否已准备；视频平台另附视频文件路径和封面路径。
- 是否允许创建 Dry Run Job；真实发布必须在 UI 中再次明确确认。

真实发布结果由系统写入 PublishRecord 后，再回填验收计划；不接受只提供截图或单元测试作为 `PublishPassed` 证据。

## V0.4 平台授权与验收

| 平台 | 用户/平台侧需要完成 | 当前边界 |
|---|---|---|
| 微信公众号 | 提供有草稿、素材和发布权限的 AppID/AppSecret；完成一次低量草稿 Dry Run，核对封面与正文；正式发布前在队列明确确认 | Adapter 代码已具备草稿、提交和 `publish_id` 回查；状态保持 `WaitingForUser` |
| 抖音 | 创建并通过开放平台应用审核；配置 Client Key、Client Secret、HTTPS 回调；申请 `video.create`；账号完成官方 OAuth | 只支持已声明的视频能力；验证码/安全验证由用户在官方页面完成 |
| 今日头条 | 创建并审核开放平台应用；配置 Client Key、Client Secret、HTTPS 回调；申请 `toutiao.video.create`、`toutiao.video.data`；确认视频不超过 128MB/1分钟 | 只支持短视频，不支持头条文章或微头条；当前状态 `WaitingForUser` |
| 快手 | 提供已审核应用、`user_video_publish` scope 与当前官方上传/发布/回查 contract；完成 OAuth | 默认运行时 contract 尚未完成审核注入，状态 `Developing`，不能仅凭凭据尝试发布 |
| 哔哩哔哩 | 提供开发者审核、专栏写入 scope、OAuth 应用与当前官方草稿/发布/回查端点 contract | 默认运行时尚未注入端点/OAuth client，状态 `Developing`；当前不宣称 B 站视频发布 |
| YouTube | 创建 Google Cloud OAuth Client，启用 YouTube Data API，准备审核/quota；完成用户授权 | 上传/回查代码存在，但 Desktop OAuth 授权 URL、交换和 refresh 尚未闭环，状态 `Developing` |
| TikTok | 通过应用审核；配置 Client Key、Client Secret、HTTPS 回调；申请 `video.publish`/`video.upload`；准备可由 TikTok 拉取的公网媒体 URL | 当前发布链只接受公网 URL，应用的本地视频资产尚未闭环，状态 `Developing` |
| 企鹅号 | 确认是否已经持有历史获批的 `client_id/client_secret` 和仍可用的第三方服务资格 | 新开发者/第三方服务申请暂停维护；没有既有资格时保持 `Blocked` |
| 小红书 | 若已有审核通过 AppKey，提供官方分享 SDK 资格证明；否则等待官方恢复接入 | 分享 SDK 只拉起原生编辑器并要求用户确认，且当前暂停新接入；保持 `Blocked` |
| 微博 | 完成开发者认证和 Weibo CLI/正式服务开通，确认官方命令契约、计费与 AI 内容标记规则 | 当前仓库尚无可安全运行的 Adapter，保持 `NotImplemented` |
| 爱奇艺 | 在爱奇艺号开放平台确认 API Token 资格和当前上传 endpoint 合同 | 官方发布/回查 API 已确认，但 Adapter 尚未实现，保持 `NotImplemented` |
| Facebook Pages | 创建 Meta App；配置 HTTPS OAuth 回调；完成 Facebook Login；申请 `pages_show_list`、`pages_manage_posts`、`pages_read_engagement` 与所需 Advanced Access/App Review；配置数字 Page ID；选择用户有权管理且具备内容创建任务的 Page | 本轮前置核验未发现真实账号或 Meta 凭据；文本/链接 Feed 代码边界已完成，但生命周期保持 `WaitingForUser`；只允许 Page，不支持个人主页；真实 Dry Run/发布均未执行 |
| Instagram Professional | 准备 Business/Creator 账号；创建 Meta App；申请 `instagram_business_basic` 与 `instagram_business_content_publish`；准备公网可取媒体 | 必须是独立 Instagram Adapter，不复用 Facebook 发布流程；当前保持 `NotImplemented` |

## ManualOnly 平台

视频号、知乎、百家号、搜狐号、一点号、大鱼号、网易号、腾讯微视、搜狐视频、皮皮虾、腾讯视频、多多视频、美拍、AcFun、快传号、雪球号、蜂网/风行号、得物、豆瓣、CSDN、简书、车家号、小红书商家号、易车号和小红书私信版当前只允许用户在平台官方页面/App 中人工操作。系统不会保存或执行未经官方授权的 selector、私有接口、主动营销私信或自动化登录流程。

## V0.6 Facebook Pages 验收入口

本轮验证结果：`VERIFICATION / FACEBOOK_DRY_RUN_BLOCKED`，`BLOCKED`。开发库和生产库均未发现 `facebook` 账号；安全凭据中没有 Meta App、OAuth 回调、Page ID 或 Page token。未发起 OAuth，未调用 Graph API，Facebook Pages 继续保持 `WaitingForUser`。

账号所有者具备条件后，按以下顺序操作：

1. 在 Meta for Developers 创建/提供 Meta App，配置 HTTPS OAuth 回调地址，并将 App ID、App Secret、回调地址和数字 Page ID 通过账号管理写入主进程安全 CredentialStore；不要在文档、Renderer 或日志中记录明文 Secret/Token。
2. 由账号所有者在 Meta 官方 Facebook Login 完成授权，申请 `pages_show_list`、`pages_manage_posts`、`pages_read_engagement`；App Review/Advanced Access、安全检查和双重验证由用户按官方流程完成。
3. 完成回调后核对 state、已授予 scopes、目标 Page ID 和 Page `CREATE_CONTENT`/等价内容创建任务；没有目标 Page 或权限不足时保持 `WaitingForUser`/`NeedsUserAction`。
4. 通过主进程 `checkLogin` 和 Page 权限预检确认 Page token 可用。Page token 只保存在安全 CredentialStore，不复制到 UI、文档或日志。
5. 准备仅含文本和/或公开 HTTP/HTTPS 链接的低风险内容；Facebook Pages 当前不接受本地图片或封面附件。
6. 先执行现有 `dryRun=true` 本地验证并记录 `networkCalls: 0`。该步骤只能证明内容门禁，不能单独升级真实 `DryRunPassed`，因为它不会调用 OAuth、Page 权限或 Feed API。
7. 只有账号所有者明确确认后，才通过持久化 Job Queue 执行一次低量 Feed 发布；系统应保存返回的 post ID 到 PublishRecord，并严禁对未知结果无限重试。
8. 使用官方 Post 状态接口回查 `is_published` 与 `permalink_url`；只有 External ID、可访问 URL 和最终状态回查都成功，才可评估 `PublishPassed`。

## V0.6.1 平台账号配置中心

1. 打开“账号管理 → 平台账号配置中心”，选择已注册平台并创建账号。账号卡片会展示平台名称、Adapter 状态、账号状态、Credential 状态、授权状态、最后验证时间、最后 Dry Run 时间和最后发布时间。
2. 微信公众号填写 AppID、AppSecret；Facebook Pages 填写 Meta App ID、OAuth 回调配置和数字 Page ID；抖音填写 Client Key、Client Secret 与 OAuth 配置；YouTube 按 Adapter 显示的 OAuth 字段完成配置。
3. 点击“保存到安全存储”。Secret 只进入 Electron 主进程 safeStorage，页面只显示“已配置”，日志和诊断导出不得包含 Token、Secret、Cookie 或 Authorization。
4. 需要 OAuth 的平台点击“开始官方授权 / OAuth”，在平台官方页面完成授权、审核、安全验证或人工确认，再把完整回调 URL 粘贴回应用完成 OAuth。系统不绕过验证码或人机验证。
5. 点击“测试连接”验证当前账号连接。该按钮只更新账号连接状态和最后验证时间，不改变平台生命周期；测试连接成功也不等于真实 `DryRunPassed`。
6. 只有账号条件完整后，才按本文件的真实验收计划执行真实 Dry Run；人工确认后再执行真实发布。缺少真实账号、Meta App、Page 权限、AppID/AppSecret 或其他必要条件时，平台保持 `WaitingForUser`。

## 生命周期升级门槛

1. 本地 validation/mock HTTP 成功只证明代码门禁，不会升级为真实 `DryRunPassed`。
2. 真实 Dry Run 必须使用账号所有者授权的账号与平台正常权限，并保存脱敏证据。
3. `PublishPassed` 必须取得一次低量真实发布的 external ID、公开 URL 和最终状态回查；无法回查时进入 `NeedsReconciliation`。
4. `Stable` 需要重复发布/回查证据、错误恢复证据以及 owner 验收，不由单元测试自动授予。
5. 任何验证码、短信、安全确认、人机验证或人工审核都暂停为 `NeedsUserAction`/`WaitingForUser`，不得绕过。

## V0.4 安装验证

1. 使用 `Geo Media Publisher Setup 0.4.0.exe`，不要把旧 `0.3.2` 安装包当作 V0.4 证据。
2. 首次启动确认平台目录为 39 个外部平台，生产环境不出现 TestPlatform。
3. 升级已有数据库前先做备份；启动后确认 migration 已应用到 `0005_v04_status_truth.sql`（若后续新增 migration，以最终清单为准）。

## 通用产品人工动作

1. 在“系统设置 → AI 设置”输入真实 AI API Key，确认 Base URL、Model、超时和有限重试，点击“测试 AI 连接”。没有 Key 时可继续使用 Mock AI 完成工程验收。
2. 在“账号管理”创建微信公众号账号，输入 AppID 和 AppSecret。AppSecret 只会进入 Electron 主进程安全存储，Renderer 只显示“已配置”。
3. 使用拥有草稿、素材和发布权限的公众号完成一次人工 Dry Run，确认草稿内容与封面；Dry Run 不会触发最终发布。
4. 需要正式发布时，在发布队列点击“确认真实发布”。如果账号允许自动发布，仍需先由账号所有者明确勾选账号级授权。
5. 若平台要求扫码、短信、验证码、安全确认或人工审核，请在平台正常页面完成，任务会停在 `NeedsUserAction`/`WaitingForUser`，系统不实现 CAPTCHA、滑块、风控或权限绕过。
6. 只有真实低量联调成功并确认 URL / externalId 后，才能把平台从 `Developing` 提升到 `PublishPassed`；单元测试或 TestPlatform 不算真实验证。
7. 恢复数据库前先确认目标备份，应用会执行 `integrity_check`、二次确认、替换数据库并重启。

## 旧版 V0.3.2 DeepSeek 连接诊断（仅历史故障排查）

1. 安装 `Geo Media Publisher Setup 0.3.2.exe`。
2. 打开：系统设置 → AI 设置 → DeepSeek。
3. 重新输入用户的 DeepSeek API Key，点击“保存密钥”。Key 会继续通过 Electron `safeStorage` 加密保存，页面和日志不显示完整 Key。
4. 点击“测试连接”。
5. 预期：显示“DeepSeek 连接成功”，认证正常，模型 `deepseek-v4-flash` 可用；“查看诊断”只显示 API 地址、认证、HTTP、模型、Chat Completion 和耗时状态。
