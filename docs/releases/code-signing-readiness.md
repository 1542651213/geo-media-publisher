# Windows code signing readiness

H 使用现有 electron-builder / NSIS 发布链；代码签名尚未配置。构建文件不含证书或私钥。当前用户证书库未发现可用的代码签名证书。实际 H Candidate 安装包的 Authenticode 结果为 **NotSigned**，签名主体为空；构建日志中的 signing 步骤不代表已签名。安装包 SHA256 为 `5546228947ba27c3401c1a82761398057b11c3e4a137664a0047fb675904629c`。

Owner 需要提供受控证书或硬件/云签名服务、签名主体、时间戳服务与安全构建凭据。不得把 PFX、口令、签名服务 Token 或私钥提交 Git。签名应在受控构建环境执行，并保留证书链、时间戳和安装程序 SHA256 的验证结果。

公开分发前推荐：签名主可执行文件与安装程序；验证 Authenticode 链和时间戳；在干净 Windows 环境安装并比对内嵌源码/构建身份。未签名不等于损坏，但不能声称发布者身份认证已完成，也不能承诺 SmartScreen 不提示。

本轮不会安装虚构证书、修改系统信任或启用自动更新。最终 H 状态见 [H READY](R1.15-H-READY.md)；签名和真实系统 DPI、硬件 IME、跨用户凭据迁移作为独立限制记录。
