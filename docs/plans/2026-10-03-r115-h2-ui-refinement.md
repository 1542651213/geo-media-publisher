# R1.15-H.2 执行计划

Spec：Owner 提供的 H.2 附件；公开复述的初审依据见 `docs/product/R1.15-H2-UI-AUDIT.md`。在指定 canonical checkout 的独立 UI Candidate branch 内执行，依既有本地 checkpoint 恢复；保留 H.1 与 main，不另建重复 checkout，不自动合并。

## Global Constraints

H.1 `0498be1` 是本轮祖先。Main / Preload / shared / domain / DB / migration / Adapter / policies / final submit / session / frozen job / batch 冻结；唯一构建差异是 deliveryId H.1→H.2。所有真实发布、final submit、远端写、云生成、production 写均 0，batch OFF。原生产 2599 文件只做文件流哈希，原始清单和 bundle 在仓库外限制 ACL 的私有目录；不可公开。

开发按 focused tests → typecheck / lint 进行，最终一次完整回归，再 build / package / isolated install。用户明确要求不反复 full suite、不提常规问题、不改已经良好的页面，优先于通用技能中的阶段批准与重复回归。可逆 CSS 布局通过实际安装截图验收，不写镜像实现的 CSS 测试；呈现语义辅助函数先验证 RED→GREEN。

### Task 1: 初审与恢复点

输入：H.1 安装 exe、闭合合成 fixture、真实本地/远端 refs。
输出：11 张 BEFORE、2 个实际抽屉观察、初审文档、production baseline、已验证 bundle / checkpoint。
验收：截图身份 H.1、启动前阻断网络、未知历史 job hash 不变。

### Task 2: 最小界面精修

输入：Task 1 的实际问题。仅修改 renderer/design、Owner leaf、必要呈现类和交付脚本。
输出：三种 density tokens；首页/表单/账号/归属/备份适度间距；Owner 七项优先级；编辑标题不拉伸；Candidate 身份。
验收：Owner 清单与未确认语义 focused RED→GREEN；478 个 IPC 调用及参数 AST 一致；360 个冻结文件无变化；typecheck / lint。

### Task 3: 双轮实际视觉复查

输入：Task 2 已 commit 的构建。
输出：独立安装 Round 1，逐张复查 11 页；只修实际问题，再独立安装 Round 2 并复查全页。
验收：相同 fixture / 1440×900 / 100%；记录 NO_CHANGE、实际修正与保留限制，保留第一轮证据。

### Task 4: 最终交付验收

输入：最终源码及 fresh whole-branch review。
输出：完整 tests（maxWorkers=4）、typecheck/lint、build、NSIS、隔离员工全流程、对话框/异常状态/99 页尺寸矩阵、11 AFTER、手机预览与 root ready 内嵌 ≥6 图。
验收：Main/IPC freeze、包内字节与 source identity、原生产哈希差异 0、source/package/public evidence secret scan PASS；未执行真实 DPI / 硬件 IME 如实标注。

### Task 5: GitHub Candidate 安全同步

输入：Task 4 经过扫描的公开源码/图片/文档及独立 installer。
输出：UI branch + Candidate tag + prerelease（不 merge main），实际浏览器打开远端 ready.md 并验证每个图片正常渲染，remote refs / source / SHA digests，最后 clean。
验收：fresh secret scan PASS 才 push；main 保持 H；ready 相对路径图片实测；checkpoint 及完整最终报告。没有安排自动续跑。

## Review Focus

确认 presentation 不把 suggestion 或静态 H 清单变成实时/发布资格；Owner 优先级不遗漏七项；折叠不遮挡关键冲突；busy/disabled/Escape/focus/IME 与原事件保持；CSS narrow/zoom 不隐藏关键动作；证据是真实安装版且合成数据，生产资料和 secret 不进入 public tree；ready 嵌入图和 GitHub 渲染证据一致。
