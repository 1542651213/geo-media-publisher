import { BackupsPage } from "./BackupWorkspace";
import { type Brand } from "@publisher/domain";
import type { JSX } from "react";
import { useEffect,useState } from "react";
import { AIContentStudio } from "./AIContentStudio";
import { AboutRelease } from './AboutRelease';
import { ColleagueDataPackage } from './ColleagueDataPackage';
import { DeepSeekSettingsPage } from "./DeepSeekSettingsPage";
import { EnterpriseProfileManager } from "./EnterpriseProfileManager";
import { ImageLibraryPage } from "./ImageLibraryPage";
import { OperationsCenter } from "./OperationsCenter";
import { PlansPageV031 } from "./PlansPageV031";
import { PlatformConnectionCenter } from "./PlatformConnectionCenter";
import { PlatformRulesPage } from "./PlatformRulesPage";
import { PlatformSelfTestCenter } from "./PlatformSelfTestCenter";
import { ProductAICenter } from "./ProductAICenter";
import { ProductAccountHealth } from "./ProductAccountHealth";
import { QualityGatePage } from "./QualityGatePage";
import { QueuePageV031 } from "./QueuePageV031";
import { V11AccountsCenter,V11AdvancedSettings,V11ArticleLibrary,V11ImageLibrary,V11Preferences,V11PublishCenter,V11Statistics } from "./V11Workspace";
import { VideoAssetCenter } from "./VideoAssetCenter";
import { DEVELOPER_ROUTES,DeveloperModeContext } from "./developer-mode";
import { flushDraftEditors } from "./draft-autosave-controller";
import { type V11NavigationTarget } from "./v11-ui-model";

import { AppShell as Layout } from "./AppShell";
import { EmptyState } from "./design/WorkspacePrimitives";
import { AiTasksPage, BatchPage, KeywordsPage, LogsPage } from "./legacy/LegacyWorkspacePages";

type Route = V11NavigationTarget;

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>("dashboard");
  const [developerMode, setDeveloperMode] = useState(false);
  useEffect(() => { void window.publisherAPI.settings.get().then(settings => setDeveloperMode(settings.developerMode === true)); }, []);
  useEffect(() => { if (!developerMode && DEVELOPER_ROUTES.has(route)) setRoute("advanced"); }, [route, developerMode]);
  const [navigationError, setNavigationError] = useState("");
  const navigate = (next: Route): void => { void flushDraftEditors().then(() => { setNavigationError(""); setRoute(!developerMode && DEVELOPER_ROUTES.has(next) ? "advanced" : next); }).catch(error => setNavigationError(error instanceof Error ? error.message : "草稿保存失败，当前页面已保留")); };
  useEffect(() => window.publisherAPI.lifecycle.onDraftFlush(requestId => { void flushDraftEditors().then(() => window.publisherAPI.lifecycle.draftFlushResult(requestId, true)).catch(error => { setNavigationError(error instanceof Error ? error.message : "草稿保存失败；应用继续保持打开"); window.publisherAPI.lifecycle.draftFlushResult(requestId, false); }); }), []);
  const toggleDeveloperMode = async (): Promise<void> => { await window.publisherAPI.settings.update("developerMode", !developerMode); setDeveloperMode(!developerMode); };
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = (): void => setRefreshKey((value) => value + 1);
  const [companies, setCompanies] = useState<Brand[]>([]), [companyId, setCompanyId] = useState(""), [switching, setSwitching] = useState(false);
  useEffect(() => { let active = true; void Promise.all([window.publisherAPI.workspace.companies(), window.publisherAPI.workspace.current()]).then(([next, current]) => { if (active) { setCompanies(next); setCompanyId(current ?? ""); } }); return () => { active = false; }; }, [refreshKey]);
  const selectCompany = async (id: string): Promise<void> => { setSwitching(true); try { await flushDraftEditors(); await window.publisherAPI.workspace.select(id); setCompanyId(id); refresh(); } catch (error) { setNavigationError(error instanceof Error ? error.message : "切换前保存失败，请重试"); } finally { setSwitching(false); } };
  return <DeveloperModeContext.Provider value={developerMode}><Layout route={route} onNavigate={navigate} companies={companies} companyId={companyId} switching={switching} onSelectCompany={selectCompany}><div key={companyId} className="company-workspace-content">{navigationError && <div role="alert" className="notice error">{navigationError}</div>}
    {route === "dashboard" && (companyId ? <OperationsCenter companyId={companyId} refresh={refresh} onNavigate={next => navigate(next as Route)} /> : <EmptyState title="今日工作台" description="请先在高级功能的企业资料中创建企业，然后选择工作区。" />)}
    {route === "operations" && (companyId ? <OperationsCenter companyId={companyId} refresh={refresh} onNavigate={next => navigate(next as Route)} /> : <EmptyState title="内容运营" description="请先创建并选择企业工作区。" />)}
    {route === "production" && <ProductAICenter refresh={refresh} />}
    {route === "ai-center" && <ProductAICenter initialTab="providers" refresh={refresh} />}
    {route === "articles" && <V11ArticleLibrary refresh={refresh} refreshKey={refreshKey} onNavigate={navigate} />}
    {route === "images" && <V11ImageLibrary refresh={refresh} refreshKey={refreshKey} />}
    {route === "accounts" && <><ProductAccountHealth refreshKey={refreshKey} /><V11AccountsCenter refresh={refresh} refreshKey={refreshKey} onNavigate={navigate} /></>}
    {route === "publishing" && <V11PublishCenter refresh={refresh} refreshKey={refreshKey} onNavigate={navigate} />}
    {route === "statistics" && <V11Statistics refreshKey={refreshKey} />}
    {route === "preferences" && <><AboutRelease/><V11Preferences /></>}
    {route === "advanced" && <V11AdvancedSettings onNavigate={navigate} developerMode={developerMode} toggleDeveloperMode={toggleDeveloperMode} />}
    {route === "studio" && <AIContentStudio refresh={refresh} />}
    {route === "quality" && <QualityGatePage refresh={refresh} />}
    {route === "quality-rules" && <PlatformRulesPage />}
    {route === "batch" && <BatchPage refresh={refresh} />}
    {route === "keywords" && <KeywordsPage />}
    {route === "ai-tasks" && <AiTasksPage />}
    {route === "assets" && <VideoAssetCenter refresh={refresh} />}
    {route === "images-advanced" && <ImageLibraryPage refresh={refresh} />}
    {(route === "brand" || route === "knowledge") && <EnterpriseProfileManager initialView={route === "knowledge" ? "knowledge" : "profile"} refresh={refresh} onNavigate={navigate} />}
    {route === "platforms" && <PlatformConnectionCenter refresh={refresh} onNavigate={(nextRoute) => setRoute(nextRoute)} />}
    {route === "self-test" && <PlatformSelfTestCenter onNavigate={navigate} />}
    {route === "plans" && <PlansPageV031 refresh={refresh} />}
    {route === "queue" && <QueuePageV031 refresh={refresh} />}
    {route === "logs" && <LogsPage />}
    {route === "backups" && <><ColleagueDataPackage companyId={companyId} onImported={refresh}/><BackupsPage /></>}
    {route === "settings" && <DeepSeekSettingsPage />}
    {route === "placeholder" && <EmptyState title="模块准备中" description="该扩展入口已纳入工作台导航，后续版本会复用现有数据与任务基础继续完善。" />}
  </div></Layout></DeveloperModeContext.Provider>;
}

