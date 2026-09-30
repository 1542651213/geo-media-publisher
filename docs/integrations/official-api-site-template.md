# OfficialAPI SiteConfig 扩展模板

当前只有 Kangyi 的只读连接实现，尚未发布验收。复用通用 OfficialApiAdapter，禁止复制品牌 Adapter。

新站点接入必须明确 siteId/brand、staging 与 production 的精确 HTTPS origins、当前 API version、独立 scope credential refs、types/taxonomy/字段/权限/limit。配置不是任意 URL 输入；Main 重新验证 health/capability/site/env。Renderer metadata only，secret Main + SafeStorage。

Huiquan / Shupai 尚未修改、未配置、未连接、未发布。不得仅替换 URL 推断兼容或 production-ready。须先读取各站点实际部署合同和权限，再配置白名单和独立验收。Kangyi 永久 unknown-result、existing Job/Intent/counter、维护对象归属规则继续适用。

目前 SiteConfig 为 `packages/adapters/official-api/src/index.ts` 的 `KANGYI_SITE_CONFIG`；后续扩展可抽出站点目录，不提前造多个业务实现。ARTICLE/CASE 的真实 API 映射和 UI 尚待产品实现，不用 site template 伪装完成。
