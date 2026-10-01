import { useEffect, useState } from "react";
import type { JSX } from "react";
import { productPlatform, type ProductAccountHealth as Health } from "../shared/product-platform-policy";
export function ProductAccountHealth({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [rows, setRows] = useState<Health[]>([]), [error, setError] = useState("");
  useEffect(() => { void window.publisherAPI.product.health().then(setRows).catch(() => setError("账号健康暂时无法读取，请重试")); }, [refreshKey]);
  return <section className="panel"><h3>账号健康与下一步</h3><p>按各平台连接方式核验身份。最后验证时间可供参考，发布前仍会重新检查远端身份。</p>{error && <p>{error}</p>}{rows.map(row => <div className="table-row" key={`${row.platformKey}:${row.accountId}`}><strong>{productPlatform(row.platformKey)?.displayName}</strong><span>{row.accountName}</span><span>{row.companyName}</span><span>{row.connectionMode === "BrowserAutomation" ? "官方浏览器" : row.connectionMode}</span><span>{row.status}</span><span>{row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString("zh-CN") : "尚未验证"}</span><span>{row.ownerNextAction}</span></div>)}</section>;
}
