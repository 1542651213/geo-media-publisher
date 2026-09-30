# 康一 OfficialAPI：本机安全导入及继续验收

当前状态：OWNER_ACTION_REQUIRED=YES，CREDENTIAL_TARGET=staging|production。历史加密 Kangyi 配置在当前 Windows 用户下无法解密；没有发现可用环境配置。不要在聊天粘贴 secret。

## 本机准备

由 Owner 在仓库以外、本机受控目录准备两个 JSON 文件。字段严格为 origin、siteId、environment、keyId、secret；环境和值须一致。下面只展示非秘密结构，secret 必须由 Owner 在本机填入真实值；placeholder 不能通过实际连接验证。

```json
{
  "origin": "https://staging.kangyihb.com",
  "siteId": "kangyi",
  "environment": "staging",
  "keyId": "OWNER_LOCAL_KEY_ID",
  "secret": "OWNER_LOCAL_RAW_UTF8_SECRET"
}
```

production 文件改为 origin=`https://xn--4gq502b.com`、environment=`production`，使用独立 production key。secret 至少32 UTF-8字节，不附加换行/trim/编码转换。文件不得放入 Git/源码/output/聊天附件/Release，不上传。

staging 凭据需服务端允许本次 ARTICLE+CASE 和 task-owned 对象清理；production 凭据必须限定本次唯一临时验收对象及安全清理。writesEnabled 不能证明 purge 权限，实际权限仍需 API 拒绝/允许事实验证。不要以 Admin 密码替代 HMAC。

## 普通 UI 导入（连接 Candidate，不是部门 Release）

1. 使用本轮连接预检 Candidate。首次检查采用显式隔离 userData；正式 production userData 的凭据配置仅在 Owner 提供有效本机文件后继续。
2. 普通账号中心 →「康一官网 · OfficialAPI」→「安全导入测试环境凭据」。在 Main 原生文件选择器选择对应 JSON。
3. Main 读取并校验实际文件、精确 origin/site/env，然后只读 health/capabilities。验证成功后才通过现有 Main Repository 创建或更新 scope 账号、通过 SafeStorage 加密保存密钥。
4. 对 production 使用「安全导入正式环境凭据」，不能将 staging 账号改为 production。重复配置使用原账号「重新安全导入」，不自动创建第二账号。
5. 点击「检查 API 连接」。成功显示连接状态、环境、site、origin、协议、types 和当前可写/只读能力。连接正常不等于官网可发布。重启后状态先为待检查连接，必须重新验证，不能盲信 DB logged_in。

Renderer 不读取文件路径或 secret，不接受用户传入的 status/FinalApproved/hash/config。通用 accounts:set-credentials 的 website 写入口被阻断。只有 metadata 返回界面。

## 继续执行范围

凭据有效后从已完成连接基础继续：产品 ARTICLE/CASE/媒体契约及 durable queue → isolated restart/uncertain tests → staging 两对象完整闭环和安全故障测试 → production 一对象闭环 →普通 UI验收 → Website ordinary ON →最终回归/独立正式 Release。

当前两个 live 环境均未创建任何测试对象、媒体、授权、Job、Intent 或 final claim。不得直接借低层客户端脚本绕开普通产品路径做正式发布。

GitHub 交付另有必要确认：当前 `1542651213/geo-media-publisher` 实测 PUBLIC，而任务要求 private。Owner 需指定已有私有仓库，或明确授权将现有仓库改为 private；确认前不推到公开仓库，不改 visibility，不创建 READY tag。
