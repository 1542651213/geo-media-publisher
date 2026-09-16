# Next owner actions — XHS hardening staging

1. 正常关闭当前 installed app 和 XHS BrowserSession；确认进程自然退出后再部署 staging，不要 taskkill、清 profile 或删除 lock。
2. 部署 `D:\GEO\releases\release-xhs-hardening-20260916-r1\win-unpacked`，核对 app.asar SHA256 `5EC51BF784931DF5BA09964A3F3390C3D8B8D145380B1BC27AB31A02F3D388D1`、better_sqlite3 SHA256 `AFA1DCAEDFC94D399413F18662D5FDA9C7025A23BC8CEF064D2986A0CEF2F60E`、Electron ABI `136`。
3. 恢复已有 XHS 账号后只运行只读 canonical runtime probe：确认同一 session/context/page、`page.url()` 与 `location.href` 一致，Creator ID 为 `960803317`。
4. 运行授权收敛：在已通过身份门后保留最新合法 `AUTHORIZED_UNUSED`，旧项只标记 `SUPERSEDED_UNUSED`；同账号再次请求应复用现有 operation，不创建第三个 active unused authorization。
5. 检查账号卡“一次性真实发布测试”按钮的确认、单飞、错误提示路径。今晚 staging 验收先停止在只读/prepare 前，不执行真实上传、ARM、completion 或 submit。
6. 若后续由 Owner 明确授权真实验收，使用全新任务对象并保持 one-shot/reconciliation 边界；任何提交结果不明确时只做只读 reconciliation，不重试。

历史 Run/Job/Record/Authorization、账号资料、cookies、browser profile 和 production-data 均保持不变。
