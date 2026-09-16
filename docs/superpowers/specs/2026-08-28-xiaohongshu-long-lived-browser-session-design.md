# Xiaohongshu 长生命周期 BrowserSession 设计

日期：2026-08-28
分支：`codex/xiaohongshu-account-connection`

## 1. 背景与问题定义

当前应用已经有一个由主进程共享的 `BrowserSessionManager`，并按
`platformKey + accountId` 保存 active session。小红书登录完成后，IPC 登录链路仍会调用
`releaseConnectionSession()`，该调用关闭整个 BrowserContext；因此“登录页关闭”和“登录会话关闭”没有被区分。
随后 `checkLogin` 或发布入口可能重新启动新的持久化 Context，无法证明它与 Owner 完成安全验证的 live Context 相同。

本设计只解决 BrowserSession/page/context 生命周期和 live-auth 状态问题，不重新设计小红书发布 Gate，也不执行真实发布。

## 2. 目标

1. 对小红书 account 1（`platformKey=xiaohongshu`、
   `accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3`）保留一个 account-scoped canonical
   BrowserContext，直到显式释放该账号会话、Context 崩溃或应用优雅退出。
2. 关闭一个 Page 只结束该次操作；关闭 Page 不得清除同一 Context，也不得影响 sibling Page。
3. 对同一 `platformKey + accountId` 的并发创建请求进行去重，最终只能得到一个 Context。
4. 登录、检查登录、打开后台和后续发布操作都使用同一个 canonical Context；每次操作使用自己的 Page。
5. 识别 `PAGE_CLOSED` 与 `CONTEXT_DISCONNECTED`/浏览器崩溃，分别执行正确的生命周期和 live-auth 状态处理。
6. DB 中的 `logged_in`/`Authorized` 继续作为持久历史状态；没有经过当前 live Context 验证时，UI 不得把它当成实时已登录。
7. 仅对小红书启用新策略，保持 Sohu、Toutiao、Weibo、Zhihu、Baijiahao 等其他 adapter 的既有行为。
8. 保持发布安全不变量：本轮及 live verification 不进入编辑器，不调用 `preparePublish()`，不创建 Job、SubmissionIntent、PublishRecord，不点击任何最终 CTA。

## 3. 非目标

- 不新增 Xiaohongshu 专用的第二个 SessionManager。
- 不把 `storageState`/credential reinjection 作为小红书运行时恢复的主路径。
- 不实现绕过二维码、验证码、安全验证、风控或手机号确认。
- 不在本轮实现或运行 PRE-SUBMIT GATE、SELF_TEST 或真实发布。
- 不修改其他平台 adapter 的业务 selector、登录流程或发布流程。
- 不把 cookie、token、Authorization、credential plaintext 或原始 storage value 写入日志或 evidence。
- 不用一次性的 profile restart 成功推断 canonical Context 身份；本轮 live verification 重点是 same-context、不同 Page identity。

## 4. 推荐架构

### 4.1 共享 Manager 的 account-scoped session registry

扩展现有 `BrowserSessionManager`，仍由 `adapter-registry` 创建一个实例并注入所有 browser adapter。
Manager 为每个精确的 `browserSessionCredentialKey(platformKey, accountId)` 保存：

- canonical BrowserContext/BrowserSession 引用；
- execution mode、profile path、runtime manifest 和 context debug identity；
- 当前 live-auth runtime state；
- 正在创建该 Context 的 Promise，用于并发合并。

增加显式的 session/page 生命周期 primitive：

- `getOrCreateSession(identity, action, executionMode)`：返回该 account 的 canonical Context，创建过程按 key 去重；
- `openOperationPage(identity, action, executionMode)`：在 canonical Context 中创建一个操作 Page；
- `closeOperationPage(identity, page)`：只关闭指定 Page，并校验 Page 属于该 account Context；
- `closeAccountSession(identity, reason)`：显式关闭 Context、浏览器资源并清除该 account runtime 引用；
- `getActiveSession(identity)`/`getRuntimeState(identity)`：只读取 live registry，不从 DB 登录字段推断 live 状态。

现有 `open()` 可保留为兼容入口，但其内部必须委托 account-scoped 去重逻辑。Manager 的 Context disconnected/browser crash 监听必须清理该 key 的 runtime 引用，并把 live 状态转为 `UNVERIFIED` 或 `NEEDS_USER_ACTION`；不得把普通 Page close 当作 Context 失效。

### 4.2 小红书策略开关

在共享 Manager 的配置中加入明确的 platform policy/capability，注册时只给
`xiaohongshu` 开启 `retainContextAfterPageClose` 与 `requiresActiveContextForOperations`。
其他平台不启用这些能力，继续由其现有 adapter 显式关闭自己的 session。

该 policy 只影响资源生命周期，不包含小红书 selector 或页面业务逻辑；selector、登录状态判断和发布能力仍留在 Xiaohongshu adapter。

### 4.3 Page 与 Context 的所有权

`BrowserSession` 的 Context 是 account-owned；Page 是 operation-owned。Adapter 方法必须遵循：

1. 取得 exact identity 的 canonical Context；
2. 创建自己的 Page；
3. 完成导航/检查/页面操作；
4. 在 `finally` 中只关闭自己的 Page；
5. 除非显式释放账号会话或 Context 断开，不关闭 Context。

用于 Owner 登录的 Page 在登录完成后关闭，但 canonical Context 保留。`page` 不再是判断整个 session 是否存活的唯一依据；判断存活必须检查 Context/Browser 连接和 registry identity。

并发操作可以共享 Context，但每个操作必须有独立 Page。关闭一个操作 Page 时不得关闭、替换或清理 sibling Page。

## 5. 生命周期流程

### 5.1 小红书登录完成

1. `accounts:begin-login` 为精确 account 建立/取得 canonical Context，并打开 Owner login Page。
2. Owner 在可见 Page 中完成平台正常登录和安全验证。
3. `completeConnection` 只在稳定 authenticated creator 页面通过后保存 credential/session metadata，并更新 runtime state 为 `AUTHENTICATED`。
4. IPC 不再对小红书调用会关闭 Context 的 `releaseConnectionSession()`；改为关闭 login Page 的 page-only release primitive。
5. 记录 `ACCOUNT_SESSION_RETAINED_AFTER_LOGIN=YES`，并保留 canonical Context。

若出现二维码、验证码、安全验证、风控、手机号确认或 `needs_user_action`，停止并要求 Owner 在该 account 的可见 Page 中完成正常验证；不得新建账号、切换 account、清 credential 或绕过保护。

### 5.2 `checkLogin`

小红书 `checkLogin` 必须优先取得现有 canonical Context，在该 Context 内创建临时检查 Page，完成真实页面检查后关闭临时 Page，保留 Context。重复检查应复用相同 `contextDebugId`，但每次可使用不同 `pageDebugId`。

如果没有 active canonical Context，按本策略不得把 cold persistent-profile launch 当成 live-auth PASS；应返回 `UNVERIFIED`/`NEEDS_USER_ACTION`，由上层按现有账号状态同步策略处理。不得自动重新登录。

### 5.3 `openBackend` 与后续发布入口

小红书 `openBackend` 使用 canonical Context 创建新 Page。Owner 关闭 backend Page 时，Context 和 sibling Page 仍然有效。

未来的 publisher/PRE-SUBMIT 入口也必须取得已验证的 canonical Context；没有它时明确返回 `NEEDS_USER_ACTION`/`UNVERIFIED`，而不是静默创建一个新的登录 Context。此次只实现 lifecycle contract，不运行发布流程。

### 5.4 Context 断开、浏览器崩溃与显式移除

- `PAGE_CLOSED`：只标记该操作完成；canonical Context 和 live state 保留。
- `CONTEXT_DISCONNECTED` 或 browser crash：清除对应 account 的 runtime 引用，runtime state 变为 `UNVERIFIED`/`NEEDS_USER_ACTION`，DB 的历史 `logged_in` 不得单独作为 live PASS。
- account remove/disconnect：只对精确 target identity 执行 Context close、credential/session cleanup，然后 archive；不得影响 sibling account。
- app shutdown：通过现有主进程 `before-quit` 统一优雅关闭所有 active Context，等待 context close、browser connection close、process exit 和 profile lock release。

## 6. Runtime 状态与 DB/UI 一致性

新增的 live-auth state 是内存 runtime registry 的派生状态，不需要把 transient Context 引用写入 DB。建议状态至少包括：

`UNVERIFIED`、`CHECKING`、`AUTHENTICATED`、`NEEDS_USER_ACTION`、`DISCONNECTED`。

账号 DB 的 `logged_in`/`Authorized` 保留为持久历史/最近已知状态。账号列表或检查结果必须合并 runtime state：没有 active validated Context 时显示“待验证/需要检查”，不能仅因 DB 字段为 `logged_in` 显示实时绿色已登录。真实检查确认失效时，沿用已有最小 DB 同步逻辑；本轮不扩大状态迁移范围。

## 7. 安全与数据不变量

实现和 live verification 必须持续满足：

- `PERSISTENT_PROFILE_CREDENTIAL_REINJECTION = NO`；canonical auth source 是 persistent profile + live Context；
- 不记录 cookie value、token、密码、验证码、Authorization header、request/response body；
- `FINAL_SUBMIT_COUNT = 0`；
- `JOB_CREATED = NO`、`INTENT_CREATED = NO`、`PUBLISH_RECORD_CREATED = NO`；
- `publish_jobs`、`submission_intents`、`publish_records` 的运行时 before/after 计数相等；
- 不清理目标 account 1 的 credential/profile，不添加账号，不切换账号，不归档账号；
- 任何最终 CTA 语义不确定、认证状态不确定或页面 ownership 不确定时立即停止。

## 8. TDD 测试矩阵

| ID | 场景 | 关键断言 |
| --- | --- | --- |
| M01 | XHS login PASS 后保留 session | login Page 可关闭；canonical Context 仍 active |
| M02 | login Page close | `PAGE_CLOSED` 不清 active session、不改 authenticated runtime state |
| M03 | checkLogin 第一次 | 使用现有 Context；新建并关闭 operation Page |
| M04 | checkLogin 第二次 | `contextDebugId` 相同；Page 可不同；不新建 Context |
| M05 | openBackend | 与 login/check 共用 Context；返回 operation Page |
| M06 | publisher/gate contract | 有 validated Context 才允许取得 operation Page；无 Context 返回 NEEDS_USER_ACTION |
| M07 | 并发创建 | `Promise.all` 同 identity 只 launch 一个 Context，所有调用拿到同一 identity |
| M08 | sibling Page isolation | 关闭 Page A 不关闭 Page B，不清 Context |
| M09 | context disconnect | 清 runtime 引用并转 UNVERIFIED/NEEDS_USER_ACTION |
| M10 | Page close vs expired | Page close 不得触发 expired；真正检查失败才同步失效状态 |
| M11 | account isolation | A/B 两个 account 的 Context、Page、runtime state 完全隔离 |
| M12 | remove A | 只关闭/清理/archive A；B 仍 active |
| M13 | graceful shutdown | 所有 Context close 完成，browser/process/profile lock 释放 |
| M14 | DB historical status | DB `logged_in` 无 live Context 时 UI/runtime 不是 live PASS |
| M15 | cold restore limitation | 没有 canonical Context 时不伪造 live PASS、不自动重登 |
| M16 | publish side effects | 生命周期和检查流程不调用 preparePublish；三张发布表计数不变 |
| M17 | other platform regression | 现有 Sohu/Toutiao/Weibo/Zhihu/Baijiahao focused tests 保持通过 |

测试 doubles 必须能区分 context identity 和 page identity，并记录 launch count、page close、context close、disconnect 事件，避免仅凭 URL 判断生命周期。

## 9. 验证与部署

实现后按顺序运行：

1. XHS/core/browser focused tests；
2. `pnpm test`；
3. `pnpm typecheck`；
4. `pnpm lint`；
5. `pnpm build`。

仅在全部通过后构建并部署新的 installed app。部署前保存现有 installed app 的可恢复 rollback 副本，并记录新旧 app.asar hash、路径和 production DB 路径。不得覆盖或修改 production DB 的历史发布计数。

## 10. Owner-controlled live verification

部署后只执行以下链路：

`Owner login PASS → close login Page → same Context check 1 → close check Page → same Context check 2 → STOP`

必须记录同一 `platformKey + accountId`、同一 profile path、同一 `contextDebugId`，以及不同 operation `pageDebugId`。本轮不做 cold restore、PRE-SUBMIT、SELF_TEST、图片上传、标题/正文、`preparePublish()` 或任何发布 CTA。

成功条件：

- `LONG_LIVED_ACCOUNT_CONTEXT_IMPLEMENTED=YES`
- `LOGIN_PAGE_CLOSE_PRESERVES_CONTEXT=PASS`
- `ACCOUNT_SESSION_REUSED=PASS`
- `CHECK_LOGIN_SAME_CONTEXT_1=PASS`
- `CHECK_LOGIN_SAME_CONTEXT_2=PASS`
- `CANONICAL_CONTEXT_SINGLETON=PASS`
- `CONCURRENT_CONTEXT_CREATION_GUARD=PASS`
- `SIBLING_CONTEXT_ISOLATION=PASS`
- `ACCOUNT_STATUS_LIVE_SYNC=PASS`
- `COLD_RESTORE_LIMITATION_DOCUMENTED=YES`
- `XIAOHONGSHU_RUNTIME_SESSION_READY=YES`
- `READY_FOR_REAL_SELF_TEST=NO`
- `FINAL_SUBMIT_COUNT=0`

任一登录、安全验证、ownership、Context reuse 或 DB 不变量无法可靠证明，立即停止并报告 `BLOCKED`，不猜测、不重试、不进入发布 Gate。

## 11. 回滚

若 focused/full verification 失败，或 installed app live verification 发现 Context ownership/reuse 不符合证据要求：停止 live 流程，保留日志和测试结果，不修改账号 credential/profile，不清理 production DB。使用部署前记录的 app.asar/installed app rollback 副本恢复应用，再重新运行验证。代码回滚只允许针对本分支新增提交进行可审计的 revert，不得使用破坏性工作树重置，也不得覆盖 unrelated dirty changes。
