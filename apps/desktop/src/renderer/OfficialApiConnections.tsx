import { useEffect, useState, type JSX } from "react";
import type { OfficialApiAccountView } from "../shared/official-api";

export function OfficialApiConnections({ refreshKey, onChanged }: { refreshKey: number; onChanged(): void }): JSX.Element {
  const [connections, setConnections] = useState<OfficialApiAccountView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void window.publisherAPI.website.listConnections().then(rows => { if (active) setConnections(current => rows.map(row => {
      const verified = current.find(view => view.accountId === row.accountId && ["CONNECTED", "READ_ONLY"].includes(view.status));
      return row.configured && verified && row.lastVerifiedAt && row.lastVerifiedAt === verified.lastVerifiedAt
        && row.environment === verified.environment && row.keyId === verified.keyId ? verified : row;
    })); })
      .catch(() => { if (active) setMessage("官网连接状态暂不可用"); });
    return () => { active = false; };
  }, [refreshKey]);
  const connect = async (environment: "staging" | "production", accountId?: string): Promise<void> => {
    setBusy(true); setMessage("");
    try {
      const view = await window.publisherAPI.website.importCredentials({ environment, ...(accountId ? { accountId } : {}) });
      onChanged();
      setConnections(current => [...current.filter(item => item.accountId !== view.accountId), view]);
      setMessage("官网凭据已安全保存，连接验证通过。官网发布仍待产品验收。");
    } catch { setMessage("导入未完成。请核对本机凭据文件、目标环境与 API 权限；密钥无需输入到聊天或界面。"); }
    finally { setBusy(false); }
  };
  const verify = async (accountId: string): Promise<void> => {
    setBusy(true); setMessage("");
    try {
      const view = await window.publisherAPI.website.verifyConnection(accountId);
      setConnections(current => current.map(item => item.accountId === accountId ? view : item));
      setMessage(view.writesEnabled ? "官网连接正常；发布仍待独立验收。" : "官网连接正常，当前凭据为只读。");
    } catch { setConnections(current => current.map(view => view.accountId === accountId ? { ...view, status: "UNVERIFIED", writesEnabled: false, contentTypes: [], apiVersion: null } : view));
      setMessage("官网当前连接验证未通过，请核对凭据和环境。未执行任何发布。"); }
    finally { setBusy(false); }
  };
  const stateLabel = (view: OfficialApiAccountView): string => ({ MISSING: "缺少凭据", DECRYPT_FAILED: "请重新导入凭据",
    UNVERIFIED: "待检查连接", CONNECTED: "连接正常", READ_ONLY: "连接正常 · 只读" })[view.status];
  return <section className="panel" aria-label="康一官网 OfficialAPI 连接">
    <h3>康一官网 · OfficialAPI</h3>
    <p>测试环境与正式环境分别配置。选择本机受控凭据文件，由软件安全保存密钥；官网发布尚未开放。</p>
    <div className="row-actions">
      {(["staging", "production"] as const).map(environment => <button className="secondary-button" key={environment}
        disabled={busy || connections.some(view => view.environment === environment)} onClick={() => void connect(environment)}>
        安全导入{environment === "staging" ? "测试环境" : "正式环境"}凭据
      </button>)}
    </div>
    {connections.map(view => <div className="v11-browser-account-item" key={view.accountId}>
      <div><strong>康一官网 · {view.environment ?? "环境待确认"}</strong>
        <span>{stateLabel(view)} · {view.configured ? "凭据已配置" : "凭据不可用"}</span>
        {view.baseUrl && <small>{view.baseUrl} · API {view.apiVersion ?? "待验证"} · {view.writesEnabled ? "API 可写" : "当前未验证写入能力"}</small>}
        {view.contentTypes.length > 0 && <small>{view.contentTypes.map(kind => kind === "article" ? "行业科普 ARTICLE" : "现场案例 CASE").join(" / ")}</small>}
      </div>
      <div className="row-actions"><button className="mini-button" disabled={busy || !view.configured} onClick={() => void verify(view.accountId)}>检查 API 连接</button>
        {view.environment && <button className="mini-button" disabled={busy} onClick={() => void connect(view.environment!, view.accountId)}>重新安全导入</button>}</div>
    </div>)}
    {message && <div className="notice" role="status">{message}</div>}
  </section>;
}
