import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Account, LoginSession, Platform } from "@publisher/domain";
import type { AccountManagementRow as AccountManagementRowView } from "../shared/api";
import { accountConnectionTarget } from "./v11-ui-model";
import { accountStatusLabel, authorizationLabel, connectionErrorMessage, disconnectFeedbackMessage, platformAccountStatusLabel, platformAuthorizationStatusLabel, platformConnectionActions, platformConnectionKind, type PlatformConnectionAction, type PlatformConnectionKind } from "./platform-connection-ui";

type Navigate = (route: "accounts") => void;
type ConnectionPhase = "opening" | "waiting" | "verifying" | "success" | "error";

interface ActiveConnection {
  account: Account;
  platform: Platform;
  session: LoginSession;
  phase: ConnectionPhase;
  message: string;
  callbackUrl: string;
}

interface PlatformConnectionCenterProps {
  refresh: () => void;
  onNavigate: Navigate;
}

export function PlatformConnectionCenter({ refresh, onNavigate }: PlatformConnectionCenterProps): JSX.Element {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [overview, setOverview] = useState<AccountManagementRowView[]>([]);
  const [selectedPlatformKey, setSelectedPlatformKey] = useState<string | null>(null);
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [credentialValues, setCredentialValues] = useState<Record<string, Record<string, string>>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const load = (): void => {
    void Promise.all([window.publisherAPI.platforms.list(), window.publisherAPI.accounts.overview()]).then(([nextPlatforms, nextOverview]) => {
      setPlatforms(nextPlatforms);
      setOverview(nextOverview);
    });
  };

  useEffect(load, [refresh]);

  const selectedPlatform = platforms.find((item) => item.platformKey === selectedPlatformKey) ?? null;
  const selectedRows = useMemo(() => selectedPlatform ? overview.filter((item) => item.account.platformKey === selectedPlatform.platformKey) : [], [overview, selectedPlatform]);
  const selectedRow = selectedRows.find((item) => item.account.id === selectedAccountId) ?? (selectedRows.length === 1 ? selectedRows[0] : null);

  useEffect(() => {
    if (selectedAccountId && !selectedRows.some((item) => item.account.id === selectedAccountId)) setSelectedAccountId(null);
  }, [selectedAccountId, selectedRows]);

  const updateMessage = (platformKey: string, message: string): void => setMessages((current) => ({ ...current, [platformKey]: message }));

  const accountFor = async (platform: Platform, intent: "connect" | "add" | "relogin", accountId?: string): Promise<Account> => {
    const rows = overview.filter((item) => item.account.platformKey === platform.platformKey);
    const target = accountId ? { accountId, createAccount: false } : accountConnectionTarget(rows, intent);
    if (target.accountId) {
      const account = rows.find((item) => item.account.id === target.accountId)?.account;
      if (!account) throw new Error("未找到指定的平台账号，已拒绝回退到其他账号");
      return account;
    }
    if (!target.createAccount) throw new Error("请先选择要重新登录的账号");
    return window.publisherAPI.accounts.create({ platformKey: platform.platformKey, name: `${platform.displayName}账号 ${rows.length + 1}` });
  };

  const openConnection = async (platform: Platform, mode: "connect" | "add" | "relogin" | "reauthorize", accountId?: string): Promise<void> => {
    setBusyKey(platform.platformKey);
    updateMessage(platform.platformKey, "正在准备连接…");
    try {
      const account = await accountFor(platform, mode === "reauthorize" ? "relogin" : mode, accountId);
      const current = overview.find((item) => item.account.id === account.id);
      if (platformConnectionKind(platform) === "oauth") {
        const status = current?.credentialStatus ?? await window.publisherAPI.accounts.credentialStatus(account.id, account.platformKey);
        if (!status.configured) {
          setSelectedPlatformKey(platform.platformKey);
          updateMessage(platform.platformKey, "请先配置开放平台应用凭据；Secret 只会保存到安全存储。");
          return;
        }
      }
      const session = await window.publisherAPI.accounts.beginLogin(account.id, account.platformKey);
      setSelectedPlatformKey(platform.platformKey);
      setActiveConnection({ account, platform, session, phase: session.opened || session.authorizationUrl ? "waiting" : "error", message: session.message ?? "请完成平台正常验证", callbackUrl: "" });
      updateMessage(platform.platformKey, session.message ?? "连接流程已启动");
      void mode;
      load();
    } catch (error) {
      updateMessage(platform.platformKey, connectionErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveCredentials = async (platform: Platform, row: AccountManagementRowView | null): Promise<void> => {
    if (!row) return;
    const values = Object.fromEntries(Object.entries(credentialValues[row.account.id] ?? {}).filter(([, value]) => value.trim()));
    if (Object.keys(values).length === 0) return;
    setBusyKey(platform.platformKey);
    try {
      const status = await window.publisherAPI.accounts.setCredentials({ accountId: row.account.id, platformKey: platform.platformKey, values });
      setCredentialValues((current) => ({ ...current, [row.account.id]: {} }));
      updateMessage(platform.platformKey, status.configured ? "开放平台应用已安全配置，现在可以连接账号。" : "凭据已保存，但仍有必填项未配置。");
      load();
    } catch (error) {
      updateMessage(platform.platformKey, error instanceof Error ? error.message : "凭据保存失败");
    } finally {
      setBusyKey(null);
    }
  };

  const completeBrowserLogin = async (): Promise<void> => {
    if (!activeConnection) return;
    setActiveConnection((current) => current ? { ...current, phase: "verifying", message: "正在验证登录状态并恢复加密 Session…" } : current);
    try {
      const result = await window.publisherAPI.accounts.completeLogin(activeConnection.account.id, activeConnection.platform.platformKey, "");
      if (result.accountStatus !== "Connected") {
        setActiveConnection((current) => current ? { ...current, phase: "error", message: "尚未检测到登录状态，请确认浏览器中已完成登录。" } : current);
        return;
      }
      setActiveConnection((current) => current ? { ...current, phase: "success", message: "登录状态已确认；Session 已安全保存并完成恢复验证。" } : current);
      updateMessage(activeConnection.platform.platformKey, "账号已连接");
      load();
      refresh();
    } catch (error) {
      setActiveConnection((current) => current ? { ...current, phase: "error", message: connectionErrorMessage(error) } : current);
    }
  };

  const completeOAuth = async (): Promise<void> => {
    if (!activeConnection || !activeConnection.callbackUrl.trim()) return;
    setActiveConnection((current) => current ? { ...current, phase: "verifying", message: "正在完成官方 OAuth 授权…" } : current);
    try {
      await window.publisherAPI.accounts.completeLogin(activeConnection.account.id, activeConnection.platform.platformKey, activeConnection.callbackUrl.trim());
      setActiveConnection((current) => current ? { ...current, phase: "success", message: "授权状态已确认，账号摘要已安全保存。" } : current);
      updateMessage(activeConnection.platform.platformKey, "账号已连接");
      load();
      refresh();
    } catch (error) {
      setActiveConnection((current) => current ? { ...current, phase: "error", message: connectionErrorMessage(error) } : current);
    }
  };

  const cancelConnection = async (): Promise<void> => {
    if (!activeConnection) return;
    try {
      await window.publisherAPI.accounts.cancelLogin(activeConnection.account.id, activeConnection.platform.platformKey);
    } catch (error) {
      updateMessage(activeConnection.platform.platformKey, connectionErrorMessage(error));
    }
    setActiveConnection(null);
    load();
  };

  const checkLogin = async (platform: Platform, row: AccountManagementRowView | null): Promise<void> => {
    if (!row) return;
    setBusyKey(platform.platformKey);
    try {
      const result = await window.publisherAPI.accounts.checkLogin(row.account.id, platform.platformKey);
      updateMessage(platform.platformKey, result.loginStatus === "logged_in" ? "Session 有效，登录状态已确认。" : "尚未检测到登录状态，请重新登录。");
      load();
    } catch (error) {
      updateMessage(platform.platformKey, connectionErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const disconnect = async (platform: Platform, row: AccountManagementRowView | null): Promise<void> => {
    if (!row || !window.confirm("只断开本地安全凭据，不会宣称平台端已经撤销授权。确定继续吗？")) return;
    setBusyKey(platform.platformKey);
    try {
      const result = await window.publisherAPI.accounts.disconnect(row.account.id, platform.platformKey);
      updateMessage(platform.platformKey, disconnectFeedbackMessage(result, row.account.accountAlias || row.account.name));
      load();
      refresh();
    } catch (error) {
      updateMessage(platform.platformKey, connectionErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const actionFor = (platform: Platform, action: PlatformConnectionAction, row: AccountManagementRowView | null = selectedRow): void => {
    if (action.kind === "connect" || action.kind === "add-account") void openConnection(platform, action.kind === "add-account" ? "add" : "connect");
    else if (action.kind === "relogin" || action.kind === "reauthorize") {
      if (!row) {
        setSelectedPlatformKey(platform.platformKey);
        updateMessage(platform.platformKey, "请先选择要重新登录的账号，系统不会自动回退到其他账号。");
        return;
      }
      void openConnection(platform, action.kind, row.account.id);
    }
    else if (action.kind === "configure") {
      setSelectedPlatformKey(platform.platformKey);
      if (!row) void accountFor(platform, "connect").then(() => load());
      updateMessage(platform.platformKey, "请在下方配置开放平台应用凭据。");
    } else if (action.kind === "view-account") setSelectedPlatformKey(platform.platformKey);
    else if (action.kind === "open-backend" && row) void window.publisherAPI.accounts.openBackend(row.account.id, platform.platformKey).then(() => updateMessage(platform.platformKey, "已使用保存的 Session 打开创作后台。"), (error: unknown) => updateMessage(platform.platformKey, connectionErrorMessage(error)));
    else setSelectedPlatformKey(platform.platformKey);
  };

  return <>
    <div className="page-title"><div><div className="eyebrow">账号管理 / V1.0.1</div><h2>平台能力目录</h2><p>从这里选择平台并直接连接账号；Adapter、账号、授权和发布验证状态分开显示。</p></div><button className="secondary-button" onClick={() => onNavigate("accounts")}>查看全部账号</button></div>
    <section className="platform-grid connection-platform-grid">{platforms.map((platform, index) => { const rows = overview.filter((item) => item.account.platformKey === platform.platformKey); const cardRow = rows.length === 1 ? rows[0] : null; const cardActions: PlatformConnectionAction[] | undefined = rows.length > 1 ? [{ kind: "view-account", label: "选择账号" }, { kind: "add-account", label: "+ 添加账号" }] : undefined; return <PlatformCard key={platform.platformKey} platform={platform} row={cardRow} accountRows={rows} actions={cardActions} index={index} busy={busyKey === platform.platformKey} message={messages[platform.platformKey]} onSelect={() => { setSelectedPlatformKey(platform.platformKey); if (rows.length === 1) setSelectedAccountId(rows[0].account.id); else setSelectedAccountId(null); }} onAction={(action) => actionFor(platform, action, cardRow)} />; })}</section>
    {selectedPlatform && selectedRows.length > 1 && <PlatformAccountPicker rows={selectedRows} selectedAccountId={selectedAccountId} onSelectAccount={setSelectedAccountId} />}
    {selectedPlatform && <PlatformDetail platform={selectedPlatform} row={selectedRow} rows={selectedRows} credentialValues={credentialValues[selectedRow?.account.id ?? ""] ?? {}} busy={busyKey === selectedPlatform.platformKey} message={messages[selectedPlatform.platformKey]} onCredentialChange={(key, value) => { if (!selectedRow) return; setCredentialValues((current) => ({ ...current, [selectedRow.account.id]: { ...(current[selectedRow.account.id] ?? {}), [key]: value } })); }} onSaveCredentials={() => void saveCredentials(selectedPlatform, selectedRow)} onAction={(action) => actionFor(selectedPlatform, action, selectedRow)} onCheck={() => void checkLogin(selectedPlatform, selectedRow)} onDisconnect={() => void disconnect(selectedPlatform, selectedRow)} onClose={() => setSelectedPlatformKey(null)} />}
    {activeConnection && <ConnectionDialog connection={activeConnection} onChangeCallback={(callbackUrl) => setActiveConnection((current) => current ? { ...current, callbackUrl } : current)} onCompleteBrowser={() => void completeBrowserLogin()} onCompleteOAuth={() => void completeOAuth()} onCancel={() => void cancelConnection()} onClose={() => setActiveConnection(null)} />}
  </>;
}

function PlatformCard({ platform, row, accountRows, actions: suppliedActions, index, busy, message, onSelect, onAction }: { platform: Platform; row: AccountManagementRowView | null; accountRows: AccountManagementRowView[]; actions?: PlatformConnectionAction[]; index: number; busy: boolean; message?: string; onSelect: () => void; onAction: (action: PlatformConnectionAction) => void }): JSX.Element {
  const actions = suppliedActions ?? platformConnectionActions(platform, row);
  const connected = row?.accountStatus === "Connected" || accountRows.some((item) => item.accountStatus === "Connected");
  const accountLabel = accountRows.length > 1 ? platformAccountStatusLabel(accountRows) : accountStatusLabel(row);
  const authorizationStatus = accountRows.length > 1 ? platformAuthorizationStatusLabel(accountRows, platformConnectionKind(platform)) : authorizationLabel(platform, row);
  const connectedCount = accountRows.filter((item) => item.accountStatus === "Connected").length;
  return <div className={`platform-card connection-platform-card ${connected ? "is-connected" : ""}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }}><div className={`platform-logo logo-${index % 6}`}>{platform.platformKey === "test" ? "T" : platform.displayName.slice(0, 1)}</div><div className="platform-card-heading"><strong>{platform.displayName}</strong><span>{platform.category}</span></div><div className="platform-status-lines"><div><span>接入方式</span><b>{integrationModeLabel(platform)}</b></div><div><span>Adapter</span><b>{platform.adapterStatus === "ready" ? "已就绪" : "不可用"}</b></div><div><span>账号</span><b>{accountLabel}</b></div><div><span>授权</span><b>{authorizationStatus}</b></div><div><span>发布验证</span><b>{row?.publishVerification === "PublishPassed" ? "已通过" : row?.publishVerification === "DryRunPassed" ? "Dry Run 已通过" : "未测试"}</b></div></div>{connected && row && <div className="connected-account-summary">{row.providerAccountName ?? row.account.name} · Session {platformConnectionKind(platform) === "browser" ? "有效" : "已授权"}</div>}{connected && !row && connectedCount > 0 && <div className="connected-account-summary">{connectedCount} 个账号已连接 · 请进入平台详情选择账号</div>}<div className="platform-actions" onClick={(event) => event.stopPropagation()}>{actions.map((action) => <button key={action.kind} className={action.kind === "connect" || action.kind === "configure" ? "primary-button" : "mini-button"} disabled={busy} onClick={() => onAction(action)}>{busy && (action.kind === "connect" || action.kind === "relogin" || action.kind === "reauthorize") ? "正在打开…" : action.label}</button>)}</div>{message && <div className="platform-message">{message}</div>}</div>;
}

function PlatformAccountPicker({ rows, selectedAccountId, onSelectAccount }: { rows: AccountManagementRowView[]; selectedAccountId: string | null; onSelectAccount: (accountId: string) => void }): JSX.Element {
  return <section className="panel platform-account-picker"><div className="panel-heading"><div><div className="eyebrow">账号选择</div><h3>选择要操作的账号</h3><span>所有登录、验证、后台和断开操作都绑定到明确的内部 accountId。</span></div></div><div className="platform-account-picker-list">{rows.map((item) => { const name = item.providerAccountName ?? item.account.accountName ?? item.account.accountAlias ?? item.account.name; return <button key={item.account.id} className={`platform-account-picker-item ${item.account.id === selectedAccountId ? "is-selected" : ""}`} onClick={() => onSelectAccount(item.account.id)}><strong>{name}</strong><span>{item.account.id}</span><em>{accountStatusLabel(item)}</em></button>; })}</div></section>;
}

function PlatformDetail({ platform, row, rows, credentialValues, busy, message, onCredentialChange, onSaveCredentials, onAction, onCheck, onDisconnect, onClose }: { platform: Platform; row: AccountManagementRowView | null; rows: AccountManagementRowView[]; credentialValues: Record<string, string>; busy: boolean; message?: string; onCredentialChange: (key: string, value: string) => void; onSaveCredentials: () => void; onAction: (action: PlatformConnectionAction) => void; onCheck: () => void; onDisconnect: () => void; onClose: () => void }): JSX.Element {
  const kind: PlatformConnectionKind = platformConnectionKind(platform);
  const actions = platformConnectionActions(platform, row);
  const fields = platform.credentialSchema ?? [];
  const hasConnectionActions = row?.accountStatus === "Connected" || row?.accountStatus === "Unverified";
  return <section className="panel platform-detail-panel"><div className="panel-heading"><div><div className="eyebrow">平台详情</div><h3>{platform.displayName}</h3><span>{platform.blockingReason ?? "使用平台官方流程完成账号连接。"}</span></div><button className="text-button" onClick={onClose}>收起</button></div><div className="platform-detail-facts"><div><span>接入方式</span><b>{integrationModeLabel(platform)}</b></div><div><span>Adapter</span><b>{platform.adapterStatus === "ready" ? "已就绪" : "不可用"}</b></div><div><span>账号</span><b>{accountStatusLabel(row)}{rows.length > 1 ? `（${rows.length} 个）` : ""}</b></div><div><span>授权</span><b>{authorizationLabel(platform, row)}</b></div><div><span>发布验证</span><b>{row?.publishVerification === "PublishPassed" ? "已通过" : row?.publishVerification === "DryRunPassed" ? "Dry Run 已通过" : "未测试"}</b></div></div>{row && <div className="platform-account-summary"><strong>{row.providerAccountName ?? row.account.name}</strong><span>{row.providerAccountId ? `账号标识：${row.providerAccountId}` : "尚未读取平台账号摘要"}</span><span>{kind === "browser" && row.accountStatus === "Connected" ? "Session：有效" : `授权状态：${row.authorizationStatus}`}</span></div>}{kind === "oauth" && row && !row.credentialStatus.configured && <div className="credential-box platform-credential-box"><div className="credential-heading">配置开放平台应用</div>{fields.map((field) => <label key={field.key}>{field.label}<input type={field.type === "secret" ? "password" : "text"} value={credentialValues[field.key] ?? ""} placeholder={field.required ? "必填；保存后不回显" : "可选；保存后不回显"} onChange={(event) => onCredentialChange(field.key, event.target.value)} /></label>)}<button className="primary-button wide" disabled={busy} onClick={onSaveCredentials}>保存到安全存储</button></div>}{message && <div className="notice success">{message}</div>}<div className="row-actions platform-detail-actions">{actions.map((action) => <button key={action.kind} className={action.kind === "connect" || action.kind === "configure" ? "primary-button" : "secondary-button"} disabled={busy} onClick={() => onAction(action)}>{action.label}</button>)}{hasConnectionActions && <><button className="secondary-button" disabled={busy} onClick={onCheck}>验证登录</button><button className="secondary-button" disabled={busy} onClick={() => onAction({ kind: kind === "browser" ? "relogin" : "reauthorize", label: kind === "browser" ? "重新登录" : "重新授权" })}>{kind === "browser" ? "重新登录" : "重新授权"}</button><button className="danger-mini mini-button" disabled={busy} onClick={onDisconnect}>移除</button></>}</div><p className="platform-detail-note">首次登录会打开可见浏览器；扫码、账号输入、验证码、短信和安全验证必须由账号所有者按平台正常流程完成。本轮不会自动点击发布。</p></section>;
}

function ConnectionDialog({ connection, onChangeCallback, onCompleteBrowser, onCompleteOAuth, onCancel, onClose }: { connection: ActiveConnection; onChangeCallback: (value: string) => void; onCompleteBrowser: () => void; onCompleteOAuth: () => void; onCancel: () => void; onClose: () => void }): JSX.Element {
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const browser = platformConnectionKind(connection.platform) === "browser";
  const success = connection.phase === "success";
  const verifying = connection.phase === "verifying";
  const failed = connection.phase === "error";
  return <div className="connection-dialog-backdrop"><section className="connection-dialog" role="dialog" aria-modal="true"><div className="panel-heading"><div><div className="eyebrow">账号连接</div><h3>{success ? "账号连接完成" : failed ? "浏览器组件启动失败" : `正在连接${connection.platform.displayName}`}</h3></div>{(success || failed) && <button className="text-button" onClick={onClose}>关闭</button>}</div><div className="connection-steps"><div className={`connection-step ${failed ? "" : "done"}`}>{failed ? "未能打开官方页面" : "✓ 已打开官方页面"}</div><div className={`connection-step ${connection.phase === "waiting" ? "active" : connection.phase === "success" ? "done" : ""}`}>{browser ? "② 请在可见浏览器中完成登录" : "② 请在系统浏览器中完成官方授权"}</div><div className={`connection-step ${verifying ? "active" : success ? "done" : ""}`}>{success ? "✓ 登录/授权状态已确认" : "③ 完成后回到这里确认"}</div></div>{connection.message && <div className={`notice ${failed ? "error" : success ? "success" : "info"}`}>{connection.message}</div>}{connection.session.diagnostic && <div className="diagnostic-panel"><button className="text-button" onClick={() => setShowDiagnostic((current) => !current)}>{showDiagnostic ? "收起详细诊断" : "查看详细诊断"}</button>{showDiagnostic && <div className="diagnostic-grid"><div><span>错误代码</span><strong>{connection.session.diagnostic.errorCode}</strong></div><div><span>模块</span><strong>{connection.session.diagnostic.module}</strong></div><div><span>时间</span><strong>{connection.session.diagnostic.timestamp}</strong></div></div>}</div>}{browser && !success && !failed && <div className="wizard-actions"><button className="primary-button" disabled={verifying} onClick={onCompleteBrowser}>{verifying ? "正在验证…" : "我已完成登录"}</button><button className="secondary-button" disabled={verifying} onClick={onCancel}>取消</button></div>}{!browser && !success && !failed && connection.session.authorizationUrl && <div className="credential-box"><small>官方授权页已在系统浏览器中打开；不要把 Client Secret 或 Token 粘贴到这里。</small><label>粘贴完整 callback URL 或 authorization code<input value={connection.callbackUrl} onChange={(event) => onChangeCallback(event.target.value)} /></label><div className="wizard-actions"><button className="primary-button" disabled={verifying || !connection.callbackUrl.trim()} onClick={onCompleteOAuth}>{verifying ? "正在授权…" : "完成授权"}</button><button className="secondary-button" disabled={verifying} onClick={onCancel}>取消</button></div></div>}{failed && <div className="wizard-actions"><button className="secondary-button" onClick={onClose}>关闭</button></div>}{success && <div className="connection-success-list"><span>✓ 登录/授权状态已确认</span><span>✓ Session/Token 已由主进程安全保存</span><span>✓ 账号已连接：{connection.account.name}</span><button className="primary-button" onClick={onClose}>返回平台管理</button></div>}</section></div>;
}

function integrationModeLabel(platform: Platform): string { const mode = platform.accountConnectionMode ?? platform.integrationMode; if (mode) return mode === "BrowserAutomation" ? "浏览器自动化" : mode === "SemiAuto" ? "半自动" : mode === "OAuth" ? "OAuth" : mode === "API" ? "官方 API" : mode === "Blocked" ? "不可接入" : "人工"; if (platform.transport === "browser") return "浏览器自动化"; if (platform.authStrategy === "OAuth2" || platform.authStrategy === "OAuth2PKCE") return "OAuth"; if (platform.transport === "official_api" || platform.transport === "official_sdk") return "官方 API"; return "人工"; }
