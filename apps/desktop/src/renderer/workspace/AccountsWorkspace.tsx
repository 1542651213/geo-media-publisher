import type { ControlledPostUploadDiscoveryResult } from "@publisher/adapters-core";
import { type Account,type Platform } from "@publisher/domain";
import type { JSX } from "react";
import { useCallback,useContext,useEffect,useRef,useState } from "react";
import type { AccountManagementRow } from "../../shared/api";
import { CONTROLLED_SELF_TEST_CONFIRMATION,ControlledSelfTestEntryGuard,buildControlledSelfTestRequest,controlledSelfTestResultMessage,supportsControlledPostUploadDiscovery } from "../../shared/controlled-self-test-entry";
import { operatorPublishBlockReason,productErrorMessage,productPlatform } from "../../shared/product-platform-policy";
import { OfficialApiConnections } from "../OfficialApiConnections";
import { DeveloperModeContext } from "../developer-mode";
import { disconnectFeedbackMessage } from "../platform-connection-ui";
import { beginPostLoginHeartbeat,runCheckLoginWithHeartbeats,runPreSubmitGateWithHeartbeats } from "../session-heartbeat";
import { accountCapabilityText,accountCenterPriority,accountConnectionTarget,accountStatusLabel,isOnlineAccount,loadAccountCenterData,platformAvailability,platformCapabilityText,platformConnectionModeLabel,platformLabel,searchOrderedPlatforms,type V11NavigationTarget } from "../v11-ui-model";

import { EmptyState as EmptyWorkspace,StatusBadge as Status,PageHeader as WorkspaceTitle } from "../design/WorkspacePrimitives";
import { classifyBrowserLoginResult } from "./workspace-utils";

export function V11AccountsCenter({ refresh, refreshKey, onNavigate }: { refresh: () => void; refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const developerMode = useContext(DeveloperModeContext);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AccountManagementRow[]>([]); const [platforms, setPlatforms] = useState<Platform[]>([]); const [tab, setTab] = useState<"connected" | "available" | "all">("all"); const [search, setSearch] = useState(""); const [favorites, setFavorites] = useState<string[]>([]); const [message, setMessage] = useState(""); const [loadError, setLoadError] = useState(""); const [busy, setBusy] = useState(""); const [controlledResults, setControlledResults] = useState<Record<string, ControlledPostUploadDiscoveryResult>>({}); const controlledEntryGuard = useRef(new ControlledSelfTestEntryGuard()).current; const [detailsKey, setDetailsKey] = useState<string | null>(null); const [pendingLogin, setPendingLogin] = useState<{ accountId: string; platformKey: string; contentKind?: "article" } | null>(null); const [loginSucceeded, setLoginSucceeded] = useState(false); const [loginHint, setLoginHint] = useState("");
  const load = useCallback((): void => {
    setLoading(true);
    void loadAccountCenterData({ overview: () => window.publisherAPI.accounts.overview(), platforms: () => window.publisherAPI.platforms.list(), settings: () => window.publisherAPI.settings.get() }).then(({ overview: nextOverview, platforms: nextPlatforms, favoritePlatformKeys, errors }) => {
      setOverview(nextOverview);
      setPlatforms(nextPlatforms);
      setFavorites(favoritePlatformKeys);
      setLoading(false);
      setLoadError(errors.length > 0 ? "账号中心部分数据暂时未加载，已保留可用数据；请点击“重试”。" : "");
    }).catch(() => {
      setLoadError("账号中心暂时无法加载，请点击“重试”。");
      setLoading(false);
    });
  }, []);
  useEffect(load, [load, refreshKey]);
  const rowsFor = (platformKey: string): AccountManagementRow[] => overview.filter((row) => row.account.platformKey === platformKey);
  const activateDouyinImageText = async (accountId: string): Promise<void> => {
    setBusy(accountId);
    try {
      const result = await window.publisherAPI.accounts.activateDouyinImageText(accountId);
      setMessage(result.status === "ACTIVE" ? "抖音图文 Creator 账号身份和受控会话已核实。"
        : result.status === "NO_STORED_AUTH" || result.status === "BINDING_REQUIRED" ? "当前没有可恢复的图文授权，请连接抖音图文 Creator。"
          : result.status === "IDENTITY_MISMATCH" ? "当前 Creator 身份与绑定账号不符，已停止。" : "会话已打开，请在平台正常页面完成登录并显示抖音号。");
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "抖音图文会话激活失败"); }
    finally { setBusy(""); }
  };
  const inspectDouyinManagement = async (accountId: string): Promise<void> => {
    setBusy(accountId);
    try {
      const result = await window.publisherAPI.accounts.preflightDouyinManagement(accountId);
      setMessage(result.ready ? `作品管理只读检查通过：${result.stateLabels.join("、")}；已回到图文入口，没有执行上传或发布。`
        : `作品管理只读检查未通过：搜索控件 ${result.searchControlCount} 个，状态 ${result.stateLabels.join("、") || "未识别"}；已回到首页。`);
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "作品管理只读检查失败"); }
    finally { setBusy(""); }
  };
  const beginAccountLogin = async (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string, contentKind?: "article"): Promise<void> => {
    const displayName = platforms.find((platform) => platform.platformKey === platformKey)?.displayName ?? platformLabel(platformKey);
    if (platformKey === "cnblogs") { setDetailsKey("cnblogs"); return; }
    setBusy(selectedAccountId ?? `${platformKey}:${intent}`); setLoginSucceeded(false); setLoginHint("");
    try {
      const rows = rowsFor(platformKey);
      const target = selectedAccountId ? { accountId: selectedAccountId, createAccount: false } : accountConnectionTarget(rows, intent);
      let account = target.accountId ? overview.find((item) => item.account.id === target.accountId && item.account.platformKey === platformKey)?.account : undefined;
      if (selectedAccountId && !account) throw new Error("未找到指定的平台账号，已拒绝替换或回退到其他账号");
      if (!account && target.createAccount) {
        const alias = platformKey === "lieju" ? `列举网-${String(rows.length + 1).padStart(2, "0")}` : `${displayName}账号 ${rows.length + 1}`;
        account = await window.publisherAPI.accounts.create({ platformKey, name: alias, accountAlias: alias, publishMode: "assisted" });
      }
      if (!account) throw new Error("未选择可连接的账号");
      const result = await window.publisherAPI.accounts.beginLogin(account.id, platformKey, contentKind);
      if (!result.opened) throw new Error(result.message || `暂时无法打开${displayName}登录页`);
      if (contentKind) setPendingLogin({ accountId: account.id, platformKey, contentKind });
      else setPendingLogin({ accountId: account.id, platformKey });
      if (platformKey === "lieju") setDetailsKey(platformKey);
      setMessage(`已打开${displayName}官方登录页。`);
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "无法开始连接，请稍后重试"); }
    finally { setBusy(""); }
  };
  const runAccountSelfTest = async (row: AccountManagementRow): Promise<void> => {
    const accountId = row.account.id;
    setBusy(accountId);
    try {
      const run = await window.publisherAPI.platformSelfTest.runSafe(accountId);
      setMessage(`${row.account.accountAlias || row.account.name} 自测结果：${run.overallResult}；已携带明确账号 ID。`);
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "平台自测失败"); }
    finally { setBusy(""); }
  };
  const runControlledPostUploadDiscovery = async (row: AccountManagementRow, platform: Platform): Promise<void> => {
    const accountId = row.account.id;
    const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
    if (!supportsControlledPostUploadDiscovery(platform, row.account) || !connected || !controlledEntryGuard.tryAcquire(accountId)) return;
    try {
      if (!window.confirm(CONTROLLED_SELF_TEST_CONFIRMATION)) return;
      const request = buildControlledSelfTestRequest({ account: row.account, platform, connected, busy: false, confirmed: true });
      if (!request) return;
      setBusy(`${accountId}:controlled-upload`); setMessage("");
      const result = await window.publisherAPI.platformSelfTest.runPostUploadDiscovery(request);
      setControlledResults((current) => ({ ...current, [accountId]: result }));
      setMessage(controlledSelfTestResultMessage(result));
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "受控首次上传后发现失败"); }
    finally { controlledEntryGuard.release(accountId); setBusy(""); }
  };
  const completeLogin = async (): Promise<void> => { if (!pendingLogin) return; setBusy(pendingLogin.accountId); setLoginHint(""); try { const result = pendingLogin.contentKind
      ? await window.publisherAPI.accounts.completeLogin(pendingLogin.accountId, pendingLogin.platformKey, "", pendingLogin.contentKind)
      : await window.publisherAPI.accounts.completeLogin(pendingLogin.accountId, pendingLogin.platformKey, ""); const classification = classifyBrowserLoginResult(result); if (classification === "CONTRACT_MISMATCH") throw new Error("LOGIN_RESULT_CONTRACT_MISMATCH: accounts:complete-login 返回了未知 accountStatus"); if (classification === "NEEDS_USER_ACTION") { setLoginHint("暂未检测到登录成功，请继续在浏览器完成登录。"); return; } if (!pendingLogin.contentKind) beginPostLoginHeartbeat(pendingLogin.accountId, pendingLogin.platformKey); setLoginSucceeded(true); setMessage(""); load(); refresh(); } catch (error) { setLoginHint(error instanceof Error ? error.message : "登录完成检查失败"); } finally { setBusy(""); } };
  const cancelPendingLogin = async (): Promise<void> => { if (!pendingLogin) return; setBusy(pendingLogin.accountId); try { await window.publisherAPI.accounts.cancelLogin(pendingLogin.accountId, pendingLogin.platformKey, pendingLogin.contentKind); } finally { setPendingLogin(null); setLoginSucceeded(false); setLoginHint(""); setBusy(""); load(); } };
  const finishLogin = (): void => { setPendingLogin(null); setLoginSucceeded(false); setLoginHint(""); setDetailsKey(null); load(); };
  const openPlatform = async (platform: Platform, row?: AccountManagementRow): Promise<void> => {
    setBusy(row?.account.id ?? platform.platformKey);
    try {
      if (row?.account.platformKey === "toutiao") {
        const result = await window.publisherAPI.accounts.activateSession(row.account.id, "toutiao");
        if (result.outcome === "OWNER_LOGIN_REQUIRED") {
          setPendingLogin({ accountId: row.account.id, platformKey: "toutiao" });
          setMessage("请在已打开的头条官方页面由账号所有者完成登录或验证。");
        } else if (result.outcome === "ACTIVATION_FAILED") setMessage(`头条会话激活失败：${result.reasonCode ?? "UNKNOWN"}`);
        else setMessage(result.outcome === "ACTIVE_REUSED" ? "已复用头条浏览器会话。" : "已恢复头条浏览器会话。");
      } else {
        if (row && (platform.accountConnectionMode ?? platform.integrationMode) === "BrowserAutomation") await window.publisherAPI.accounts.openBackend(row.account.id, platform.platformKey);
        else await window.publisherAPI.platforms.open(platform.platformKey);
        setMessage(`已打开${platform.displayName}官方入口。`);
      }
      load();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "平台入口暂时无法打开"); }
    finally { setBusy(""); }
  };
  const checkLogin = async (row: AccountManagementRow): Promise<void> => { setBusy(row.account.id); try { const result = await runCheckLoginWithHeartbeats(row.account.id, row.account.platformKey, () => window.publisherAPI.accounts.checkLogin(row.account.id, row.account.platformKey)); setMessage(result.loginStatus === "logged_in" ? `${row.account.accountAlias || row.account.name} 登录有效。` : `${row.account.accountAlias || row.account.name} 需要重新登录或完成验证。`); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "登录检查失败"); } finally { setBusy(""); } };
  const inspectPublishEditor = async (row: AccountManagementRow): Promise<void> => { setBusy(row.account.id); try { const result = await runPreSubmitGateWithHeartbeats(row.account.id, row.account.platformKey, () => window.publisherAPI.accounts.inspectPublishEditor(row.account.id, row.account.platformKey)); setMessage(result.status === "ready" ? `${row.account.accountAlias || row.account.name} 图文编辑器已通过只读 Gate。` : `${row.account.accountAlias || row.account.name} 图文编辑器 Gate：${result.status}。`); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "图文编辑器 Gate 失败"); } finally { setBusy(""); } };
  const disconnect = async (row: AccountManagementRow): Promise<void> => { if (!window.confirm("移除后会清除此账号的登录状态和本地会话，但不会删除历史发布记录。确定继续吗？")) return; setBusy(row.account.id); try { const result = await window.publisherAPI.accounts.disconnect(row.account.id, row.account.platformKey); setMessage(disconnectFeedbackMessage(result, row.account.accountAlias || row.account.name)); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "移除失败"); } finally { setBusy(""); } };
  const rename = async (row: AccountManagementRow, alias: string): Promise<void> => { if (!alias.trim()) return; await window.publisherAPI.accounts.update(row.account.id, { accountAlias: alias.trim() }); load(); refresh(); };
  const toggleFavorite = (platformKey: string): void => { const next = favorites.includes(platformKey) ? favorites.filter((key) => key !== platformKey) : [...favorites, platformKey]; setFavorites(next); void window.publisherAPI.settings.update("favoritePlatformKeys", next.join(",")); };
  const accounts = overview.map((row) => ({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState }));
  const ordered = platforms;
  const catalog = searchOrderedPlatforms(ordered.filter((platform) => { const priority = accountCenterPriority(platform, accounts); if (tab === "connected") return priority === "CONNECTED"; if (tab === "available") return priority === "CONNECTABLE"; return true; }), search);
  return <>
    <WorkspaceTitle eyebrow="账号中心" title="管理运营平台" description={loading ? "正在读取平台目录…" : `按产品顺序展示 ${platforms.length} 个运营平台；连接状态与发布能力分别显示。`} action={developerMode ? <button className="secondary-button" onClick={() => onNavigate("self-test")}>平台自测</button> : undefined} />
    {message && <div className="notice">{message}</div>}
    {loadError && <div className="notice warning"><span>{loadError}</span><button className="mini-button" onClick={load}>重试</button></div>}
    <div className="panel v111-account-toolbar"><div className="v11-category-tabs"><button className={tab === "connected" ? "active" : ""} onClick={() => setTab("connected")}>已连接</button><button className={tab === "available" ? "active" : ""} onClick={() => setTab("available")}>可连接</button><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>全部平台</button></div><div className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索平台" /></div><strong>{loading ? "加载中…" : `${catalog.length} / ${platforms.length}`}</strong></div>
    {favorites.length > 0 && tab === "all" && !search && <div className="v111-favorite-summary"><strong>常用平台</strong><span>{platforms.filter((platform) => favorites.includes(platform.platformKey)).map((platform) => platform.displayName).join("、")}</span></div>}
    <OfficialApiConnections refreshKey={refreshKey} onChanged={refresh} />
    <AccountPlatformGrid catalog={catalog} accounts={accounts} favorites={favorites} busy={busy} controlledResults={controlledResults} rowsFor={rowsFor} onNavigate={onNavigate} onFavorite={toggleFavorite} onDetails={setDetailsKey} beginAccountLogin={beginAccountLogin} activateDouyinImageText={activateDouyinImageText} inspectDouyinManagement={inspectDouyinManagement} runAccountSelfTest={runAccountSelfTest} runControlledPostUploadDiscovery={runControlledPostUploadDiscovery} openPlatform={openPlatform} checkLogin={checkLogin} inspectPublishEditor={inspectPublishEditor} disconnect={disconnect} />
    {detailsKey === "lieju" && <LiejuAccountDrawer rows={rowsFor("lieju")} busy={busy} pendingLogin={pendingLogin?.platformKey === "lieju" ? pendingLogin : null} onClose={() => setDetailsKey(null)} onAdd={() => void beginAccountLogin("lieju", "add")} onOpen={(row) => void openPlatform(platforms.find((item) => item.platformKey === "lieju") as Platform, row)} onCheck={(row) => void checkLogin(row)} onRelogin={(row) => void beginAccountLogin("lieju", "relogin", row.account.id)} onComplete={() => void completeLogin()} onRename={(row, alias) => void rename(row, alias)} onDisconnect={(row) => void disconnect(row)} onPublish={() => onNavigate("publishing")} />}
    {detailsKey === "cnblogs" && <CnblogsAccountDrawer rows={rowsFor("cnblogs")} busy={busy} onClose={() => setDetailsKey(null)} onEnsureAccount={async () => rowsFor("cnblogs")[0]?.account ?? window.publisherAPI.accounts.create({ platformKey: "cnblogs", name: "博客园账号", accountAlias: "博客园账号", publishMode: "assisted" })} onSaved={() => { load(); refresh(); }} onMessage={setMessage} onCheck={(row) => void checkLogin(row)} onPublish={() => onNavigate("publishing")} />}
    {pendingLogin && (pendingLogin.platformKey !== "lieju" || loginSucceeded) && <BrowserLoginLifecycleDialog platformName={platforms.find((item) => item.platformKey === pendingLogin.platformKey)?.displayName ?? platformLabel(pendingLogin.platformKey)} succeeded={loginSucceeded} busy={busy === pendingLogin.accountId} hint={loginHint} onComplete={() => void completeLogin()} onCancel={() => void cancelPendingLogin()} onFinish={finishLogin} />}
  </>;
}

interface AccountPlatformGridProps {
  catalog: Platform[];
  accounts: Account[];
  favorites: string[];
  busy: string;
  controlledResults: Record<string, ControlledPostUploadDiscoveryResult>;
  rowsFor: (platformKey: string) => AccountManagementRow[];
  onNavigate: (route: V11NavigationTarget) => void;
  onFavorite: (platformKey: string) => void;
  onDetails: (platformKey: string | null) => void;
  beginAccountLogin: (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string, contentKind?: "article") => Promise<void>;
  activateDouyinImageText: (accountId: string) => Promise<void>;
  inspectDouyinManagement: (accountId: string) => Promise<void>;
  runAccountSelfTest: (row: AccountManagementRow) => Promise<void>;
  runControlledPostUploadDiscovery: (row: AccountManagementRow, platform: Platform) => Promise<void>;
  openPlatform: (platform: Platform, row?: AccountManagementRow) => Promise<void>;
  checkLogin: (row: AccountManagementRow) => Promise<void>;
  inspectPublishEditor: (row: AccountManagementRow) => Promise<void>;
  disconnect: (row: AccountManagementRow) => Promise<void>;
}

function BrowserAccountRow({ row, platform, busy, controlledResults, runAccountSelfTest, runControlledPostUploadDiscovery, openPlatform, checkLogin, inspectPublishEditor, beginAccountLogin, disconnect }: { row: AccountManagementRow; platform: Platform; busy: string; controlledResults: Record<string, ControlledPostUploadDiscoveryResult>; runAccountSelfTest: (row: AccountManagementRow) => Promise<void>; runControlledPostUploadDiscovery: (row: AccountManagementRow, platform: Platform) => Promise<void>; openPlatform: (platform: Platform, row?: AccountManagementRow) => Promise<void>; checkLogin: (row: AccountManagementRow) => Promise<void>; inspectPublishEditor: (row: AccountManagementRow) => Promise<void>; beginAccountLogin: (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string, contentKind?: "article") => Promise<void>; disconnect: (row: AccountManagementRow) => Promise<void> }): JSX.Element {
  const accountBusy = busy === row.account.id;
  const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
  const developerMode = useContext(DeveloperModeContext);
  const controlledBusy = busy === `${row.account.id}:controlled-upload`;
  const controlledAvailable = supportsControlledPostUploadDiscovery(platform, row.account);
  const controlledResult = controlledResults[row.account.id];
  const accountActionBusy = accountBusy || controlledBusy;
  return <div className="v11-browser-account-item"><div><strong>{row.account.accountName || row.providerAccountName || row.account.accountAlias || row.account.name}</strong><span>{accountStatusLabel({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState })}</span>{platform.platformKey === "toutiao" && row.account.loginStatus === "logged_in" && row.accountStatus === "Unverified" && <small>授权已保存，浏览器会话未启动</small>}{controlledResult && <small>首次上传后发现：{controlledResult.status === "PASS" ? "上传后编辑器检查完成" : `安全停止（${controlledResult.failureCode ?? "未知"}）`}</small>}</div><div className="row-actions">{developerMode && <button className="mini-button" disabled={accountActionBusy} onClick={() => void runAccountSelfTest(row)}>自测</button>}<button className="mini-button" disabled={accountActionBusy || (!connected && platform.platformKey !== "toutiao")} onClick={() => void openPlatform(platform, row)}>{platform.platformKey === "toutiao" ? "激活会话" : "打开后台"}</button><button className="mini-button" disabled={accountActionBusy} onClick={() => void checkLogin(row)}>检查登录</button>{developerMode && platform.platformKey === "xiaohongshu" && <button className="mini-button" disabled={accountActionBusy || !connected} onClick={() => void inspectPublishEditor(row)}>检查图文编辑器</button>}{developerMode && controlledAvailable && <button className="secondary-button" disabled={accountActionBusy || !connected || !row.account.enabled || Boolean(row.account.archivedAt)} onClick={() => void runControlledPostUploadDiscovery(row, platform)}>{controlledBusy ? "检查中…" : "首次上传后发现"}</button>}<button className="mini-button" disabled={accountActionBusy} onClick={() => void beginAccountLogin(platform.platformKey, "relogin", row.account.id)}>重新登录</button><button className="mini-button danger-mini" disabled={accountActionBusy} onClick={() => void disconnect(row)}>移除</button></div></div>;
}

function AccountPlatformGrid({ catalog, accounts, favorites, busy, controlledResults, rowsFor, onNavigate, onFavorite, onDetails, beginAccountLogin, activateDouyinImageText, inspectDouyinManagement, runAccountSelfTest, runControlledPostUploadDiscovery, openPlatform, checkLogin, inspectPublishEditor, disconnect }: AccountPlatformGridProps): JSX.Element {
  return <section className="v11-account-grid v111-platform-grid">{catalog.map((platform) => {
    const rows = rowsFor(platform.platformKey);
    const connectedRows = rows.filter((row) => isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState }));
    const attentionRows = rows.filter((row) => row.accountStatus === "Expired" || row.accountStatus === "NeedsLogin");
    const connected = connectedRows.length > 0;
    const availability = platformAvailability(platform);
    const policy = productPlatform(platform.platformKey);
    const developmentOnly = platform.platformKey === "website" || platform.platformKey === "netease_media";
    const mode = platform.accountConnectionMode ?? platform.integrationMode;
    const browser = mode === "BrowserAutomation";
    const onlyRow = rows.length === 1 ? rows[0] : null;
    const publishVerification = connectedRows.find((row) => row.publishVerification !== "NotTested")?.publishVerification ?? "NotTested";
    const status = developmentOnly ? policy?.statusLabel ?? "待开发" : connected ? connectedRows.length > 1 ? `已连接 ${connectedRows.length} 个账号` : "已连接" : rows.some((row) => row.accountStatus === "Unverified") ? "待验证" : availability === "blocked" ? "暂不可用" : availability === "developing" ? "开发中" : accountCenterPriority(platform, accounts) === "CONFIG_REQUIRED" ? "需要配置" : "未连接";
    const capabilityText = developmentOnly ? policy?.statusDescription ?? "尚未接入" : connected ? accountCapabilityText(platform, publishVerification) : platformCapabilityText(platform);
    return <article className={`panel v11-account-card ${platform.platformKey === "lieju" || platform.platformKey === "cnblogs" ? "clickable" : ""}`} key={platform.platformKey} onClick={() => (platform.platformKey === "lieju" || platform.platformKey === "cnblogs") && onDetails(platform.platformKey)}>
      <button className={`v111-favorite ${favorites.includes(platform.platformKey) ? "active" : ""}`} title="设为常用" onClick={(event) => { event.stopPropagation(); onFavorite(platform.platformKey); }}>★</button>
      <div className="v11-account-head"><div className="platform-avatar">{platform.displayName.slice(0, 1)}</div><div><strong>{platform.displayName}</strong><span>{capabilityText}</span><small>{policy?.statusLabel} · {policy?.statusDescription}</small>{!developmentOnly && <small className="v11-connection-mode">连接方式：{platformConnectionModeLabel(platform)}</small>}</div><Status label={status} tone={developmentOnly ? "muted" : connected ? "success" : availability === "blocked" || availability === "developing" ? "muted" : "warning"} /></div>
      <div className="v11-account-brief"><span>{platform.platformKey === "lieju" ? `列举网账号：${connectedRows.length} / 13 已连接` : rows.length > 0 ? `${rows.length} 个账号容器` : "尚未添加账号"}</span><span>{rows.some((row) => row.account.lastPublishAt) ? `最近发布 ${new Date(Math.max(...rows.map((row) => Date.parse(row.account.lastPublishAt ?? "") || 0))).toLocaleDateString("zh-CN")}` : "还没有发布记录"}</span></div>
      {browser && platform.platformKey !== "lieju" && rows.length > 0 && <div className="v11-browser-account-list" onClick={(event) => event.stopPropagation()}>{rows.map((row) => <BrowserAccountRow key={row.account.id} row={row} platform={platform} busy={busy} controlledResults={controlledResults} runAccountSelfTest={runAccountSelfTest} runControlledPostUploadDiscovery={runControlledPostUploadDiscovery} openPlatform={openPlatform} checkLogin={checkLogin} inspectPublishEditor={inspectPublishEditor} beginAccountLogin={beginAccountLogin} disconnect={disconnect} />)}</div>}
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>{platform.platformKey === "douyin" && onlyRow && <button className="secondary-button" disabled={busy === onlyRow.account.id} onClick={() => void beginAccountLogin("douyin", "relogin", onlyRow.account.id, "article")}>连接抖音图文 Creator</button>}{platform.platformKey === "douyin" && onlyRow && <button className="mini-button" disabled={busy === onlyRow.account.id} onClick={() => void activateDouyinImageText(onlyRow.account.id)}>激活图文会话</button>}{platform.platformKey === "douyin" && onlyRow && <button className="mini-button" disabled={busy === onlyRow.account.id} onClick={() => void inspectDouyinManagement(onlyRow.account.id)}>检查作品管理</button>}{connected && !browser && !operatorPublishBlockReason(platform.platformKey, platform) && <button className="primary-button" onClick={() => onNavigate("publishing")}>发布文章</button>}{browser && !connected && rows.length === 0 && <button className="primary-button" disabled={busy === platform.platformKey} onClick={() => void beginAccountLogin(platform.platformKey, "connect")}>{attentionRows.length > 0 ? "重新登录" : "连接账号"}</button>}{browser && platform.platformKey !== "lieju" && <button className={connected ? "secondary-button" : "primary-button"} disabled={busy === platform.platformKey} onClick={() => void beginAccountLogin(platform.platformKey, "add")}>+ 添加账号</button>}{platform.platformKey === "lieju" && <button className="secondary-button" onClick={() => onDetails("lieju")}>{rows.length ? "管理账号" : "+ 添加账号"}</button>}{platform.platformKey === "cnblogs" && <button className="primary-button" onClick={() => onDetails("cnblogs")}>{connected ? "管理博客园" : "连接博客园"}</button>}{!developmentOnly && !browser && platform.platformKey !== "lieju" && platform.platformKey !== "cnblogs" && connected && onlyRow && <><button className="secondary-button" disabled={busy === onlyRow.account.id} onClick={() => void openPlatform(platform, onlyRow)}>打开后台</button><button className="mini-button" disabled={busy === onlyRow.account.id} onClick={() => void beginAccountLogin(platform.platformKey, "relogin", onlyRow.account.id)}>重新登录</button></>}{!connected && !browser && mode === "SemiAuto" && <><button className="secondary-button" onClick={() => void openPlatform(platform)}>打开平台</button><button className="mini-button" onClick={() => onNavigate("articles")}>准备内容</button></>}{!developmentOnly && !connected && !browser && availability === "manual" && <button className="secondary-button" onClick={() => void openPlatform(platform)}>打开平台</button>}{!connected && availability === "blocked" && <span className="v111-unavailable">暂不可用</span>}{!connected && availability === "developing" && <span className="v111-unavailable">开发中</span>}</div>
    </article>;
  })}</section>;
}

function BrowserLoginLifecycleDialog({ platformName, succeeded, busy, hint, onComplete, onCancel, onFinish }: { platformName: string; succeeded: boolean; busy: boolean; hint: string; onComplete: () => void; onCancel: () => void; onFinish: () => void }): JSX.Element {
  return <div className="drawer-backdrop"><aside className="drawer v11-drawer v114-login-dialog" onClick={(event) => event.stopPropagation()}>{succeeded ? <><div className="v114-login-success"><span>✓</span><div><h2>登录成功</h2><strong>{platformName}账号已连接</strong><p>登录状态已安全保存。</p></div></div><div className="drawer-footer"><button className="primary-button" onClick={onFinish}>完成</button></div></> : <><div className="drawer-head"><div><span className="eyebrow">连接账号</span><h2>完成{platformName}登录</h2></div></div><div className="notice warning"><strong>官方登录页已打开</strong><span>请在专用浏览器中正常完成登录、验证码或安全验证；系统不会绕过平台验证。</span></div>{hint && <div className="notice error">{hint}</div>}<div className="drawer-footer"><button className="secondary-button" disabled={busy} onClick={onCancel}>取消连接</button><button className="primary-button" disabled={busy} onClick={onComplete}>{busy ? "正在检查…" : "我已完成登录"}</button></div></>}</aside></div>;
}

function LiejuAccountDrawer({ rows, busy, pendingLogin, onClose, onAdd, onOpen, onCheck, onRelogin, onComplete, onRename, onDisconnect, onPublish }: { rows: AccountManagementRow[]; busy: string; pendingLogin: { accountId: string; platformKey: string } | null; onClose: () => void; onAdd: () => void; onOpen: (row: AccountManagementRow) => void; onCheck: (row: AccountManagementRow) => void; onRelogin: (row: AccountManagementRow) => void; onComplete: () => void; onRename: (row: AccountManagementRow, alias: string) => void; onDisconnect: (row: AccountManagementRow) => void; onPublish: () => void }): JSX.Element {
  const connected = rows.filter((row) => row.account.loginStatus === "logged_in").length;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer v112-account-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">列举网账号</span><h2>{connected >= 13 ? "13 个账号已连接" : `${connected} / 13 已连接`}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="notice">每个账号使用独立 Browser Session。分类、地区、联系方式、拼图/验证码和最终提交由你在官方页面确认。</div><button className="primary-button" onClick={onAdd}>+ 添加账号</button>{pendingLogin && <div className="notice warning"><strong>官方登录页已打开</strong><span>完成正常登录和平台验证后再继续。</span><button className="primary-button" disabled={busy === pendingLogin.accountId} onClick={onComplete}>我已完成登录</button></div>}<div className="v112-account-list">{rows.length === 0 ? <EmptyWorkspace title="还没有列举网账号" description="逐个添加即可，不需要一次连接 13 个。" /> : rows.map((row) => <LiejuAccountRow key={row.account.id} row={row} busy={busy === row.account.id} onOpen={() => onOpen(row)} onCheck={() => onCheck(row)} onRelogin={() => onRelogin(row)} onRename={(alias) => onRename(row, alias)} onDisconnect={() => onDisconnect(row)} onPublish={onPublish} />)}</div></aside></div>;
}

function LiejuAccountRow({ row, busy, onOpen, onCheck, onRelogin, onRename, onDisconnect, onPublish }: { row: AccountManagementRow; busy: boolean; onOpen: () => void; onCheck: () => void; onRelogin: () => void; onRename: (alias: string) => void; onDisconnect: () => void; onPublish: () => void }): JSX.Element {
  const [alias, setAlias] = useState(row.account.accountAlias || row.account.name);
  return <article className="panel v112-account-row"><div className="v112-account-row-head"><input aria-label="账号别名" value={alias} onChange={(event) => setAlias(event.target.value)} onBlur={() => alias.trim() !== (row.account.accountAlias || row.account.name) && onRename(alias)} /><Status label={accountStatusLabel({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState })} tone={row.account.loginStatus === "logged_in" ? "success" : "warning"} /></div><div className="v112-account-meta"><span>平台账号名：{row.account.accountName || row.providerAccountName || "登录后获取"}</span><span>Session：{row.account.browserSessionId ? "已安全保存" : "未保存"}</span><span>今日发布：{row.account.todayPublishCount}</span><span>最近发布时间：{row.account.lastPublishAt ? new Date(row.account.lastPublishAt).toLocaleString("zh-CN") : "暂无"}</span></div><div className="row-actions"><button className="secondary-button" disabled={busy || row.account.loginStatus !== "logged_in"} onClick={onOpen}>打开后台</button><button className="mini-button" disabled={busy} onClick={onCheck}>检查登录</button><button className="mini-button" disabled={busy} onClick={onRelogin}>重新登录</button><button className="primary-button" disabled={row.account.loginStatus !== "logged_in"} onClick={onPublish}>发布文章</button><button className="mini-button danger-mini" disabled={busy} onClick={onDisconnect}>移除</button></div></article>;
}

function CnblogsAccountDrawer({ rows, busy, onClose, onEnsureAccount, onSaved, onMessage, onCheck, onPublish }: { rows: AccountManagementRow[]; busy: string; onClose: () => void; onEnsureAccount: () => Promise<Account>; onSaved: () => void; onMessage: (message: string) => void; onCheck: (row: AccountManagementRow) => void; onPublish: () => void }): JSX.Element {
  const [blogUrl, setBlogUrl] = useState(""); const [blogApp, setBlogApp] = useState(""); const [pat, setPat] = useState(""); const [saving, setSaving] = useState(false); const row = rows[0];
  const save = async (): Promise<void> => { setSaving(true); try { const account = row?.account ?? await onEnsureAccount(); const values: Record<string, string> = {}; if (blogUrl.trim()) values.blogUrl = blogUrl.trim(); if (blogApp.trim()) values.blogApp = blogApp.trim(); if (pat.trim()) values.pat = pat.trim(); if (!row?.credentialStatus.configured && !values.pat) throw new Error("请填写 Personal Access Token"); await window.publisherAPI.accounts.setCredentials({ accountId: account.id, platformKey: "cnblogs", values }); setPat(""); const result = await window.publisherAPI.accounts.checkLogin(account.id, "cnblogs"); onMessage(result.loginStatus === "logged_in" ? "博客园官方 API 连接验证通过；这不等于 PublishPassed。" : "凭据已安全保存，但官方 API 连接验证未通过。"); onSaved(); } catch (error) { onMessage(error instanceof Error ? error.message : "博客园配置保存失败"); } finally { setSaving(false); } };
  const stage = row?.connectionStage ?? (row?.credentialStatus.configured ? "CredentialConfigured" : "NotConfigured");
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer v112-account-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">博客园</span><h2>官方 API 连接</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="v112-stage"><Status label={stage} tone={stage === "ConnectionPassed" || stage === "PublishReady" || stage === "PublishPassed" ? "success" : "warning"} /><span>{row?.account.lastVerifiedAt ? `最后验证 ${new Date(row.account.lastVerifiedAt).toLocaleString("zh-CN")}` : "尚未完成真实连接验证"}</span></div><label>博客地址<input value={blogUrl} onChange={(event) => setBlogUrl(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "blogUrl")?.configured ? "已配置；留空保持不变" : "https://www.cnblogs.com/your-blog/"} /></label><label>Blog App（可选）<input value={blogApp} onChange={(event) => setBlogApp(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "blogApp")?.configured ? "已配置；留空保持不变" : "仅后台明确要求时填写"} /></label><label>Personal Access Token<input type="password" autoComplete="new-password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "pat")?.configured ? "已配置；不会回显" : "粘贴 PAT"} /></label><div className="notice">PAT 由主进程 safeStorage 加密保存；Renderer 只能看到“已配置”，无法读取完整 PAT。先在本地准备，单独确认后单次创建并进入审核。</div><div className="row-actions"><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "验证中…" : row ? "保存并验证连接" : "连接博客园"}</button>{row && <button className="secondary-button" disabled={busy === row.account.id} onClick={() => onCheck(row)}>重新验证</button>}{row?.account.loginStatus === "logged_in" && <button className="secondary-button" onClick={onPublish}>发布文章</button>}</div></aside></div>;
}

