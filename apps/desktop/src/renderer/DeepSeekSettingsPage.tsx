import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { AIConnectionResult } from "@publisher/ai";

export function DeepSeekSettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [testResult, setTestResult] = useState<AIConnectionResult | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => { void window.publisherAPI.settings.get().then(setSettings); }, []);
  const save = (key: string, value: string | number | boolean): void => { setSettings((current) => ({ ...current, [key]: value })); void window.publisherAPI.settings.update(key, value); };
  const saveKey = async (): Promise<void> => { if (!secret.trim()) return; try { const saved = await window.publisherAPI.settings.setSecret("apiKey", secret.trim()); setSecret(""); setTestResult(saved.validationResult ?? null); const nextSettings = await window.publisherAPI.settings.get(); setSettings(nextSettings); setShowDiagnostic(saved.validationResult?.ok === false); setMessage(saved.validationStatus === "Validated" ? "DeepSeek API Key 已安全保存并验证成功" : saved.validationStatus === "DecryptFailed" ? "已保存的 DeepSeek 凭据无法在当前 Windows 用户环境中解密，请重新输入 API Key。" : saved.validationStatus === "Invalid" || saved.validationStatus === "ExpiredOrRejected" ? "DeepSeek API Key 已保存，但验证未通过，请检查 Key 状态。" : "DeepSeek API Key 已安全保存，连接验证未完成"); } catch (error) { setMessage(error instanceof Error ? error.message : "DeepSeek API Key 保存失败"); } };
  const test = async (): Promise<void> => { setTesting(true); setTestResult(null); try { const result = await window.publisherAPI.settings.testAi(); setTestResult(result); setMessage(result.message); setShowDiagnostic(!result.ok); } catch (error) { setMessage(error instanceof Error ? error.message : "DeepSeek 连接诊断失败"); } finally { setTesting(false); void window.publisherAPI.settings.get().then(setSettings); } };
  const enabled = settings.deepseekEnabled !== false;
  const quality = settings.deepseekGenerationMode === "quality";
  const diagnostic = testResult?.diagnostic;
  const statusText = (value: "normal" | "failed" | "not_tested" | undefined): string => value === "normal" ? "正常" : value === "failed" ? "失败" : "未检测";
  return <><PageTitle eyebrow="系统设置 / AI 设置" title="DeepSeek" description="DeepSeek 是一等公民 Provider。API Key 只在主进程安全存储，Renderer 只能看到配置状态。" action={<button className="secondary-button" onClick={() => void test()} disabled={testing}>{testing ? "测试中…" : "测试连接"}</button>} />
    {message && <div className={`notice ${testResult?.ok === false ? "error" : "success"}`}>{message}{testResult?.ok === false && diagnostic && <button className="text-button" onClick={() => setShowDiagnostic((visible) => !visible)}>{showDiagnostic ? "收起诊断" : "查看诊断"}</button>}</div>}
    {testResult?.ok && diagnostic && <div className="notice success">认证：{statusText(diagnostic.authentication)}{" · "}API：{statusText(diagnostic.api)}{" · "}模型：{diagnostic.model}{" · "}模型状态：{diagnostic.modelStatus === "normal" ? "可用" : statusText(diagnostic.modelStatus)}{" · "}耗时：{diagnostic.durationMs} ms</div>}
    {showDiagnostic && diagnostic && <section className="panel diagnostic-panel"><div className="panel-heading"><div><h3>连接诊断</h3><span>仅显示状态和安全诊断信息，不显示 API Key 或完整请求 Header</span></div></div><div className="diagnostic-grid"><div><span>API 地址</span><strong>{statusText(diagnostic.apiAddress)}</strong></div><div><span>认证</span><strong>{statusText(diagnostic.authentication)}</strong></div><div><span>HTTP</span><strong>{diagnostic.httpStatus ?? "未返回"}</strong></div><div><span>模型</span><strong>{diagnostic.modelStatus === "normal" ? `${diagnostic.model} 可用` : statusText(diagnostic.modelStatus)}</strong></div><div><span>Chat Completion</span><strong>{statusText(diagnostic.chatCompletion)}</strong></div><div><span>耗时</span><strong>{diagnostic.durationMs} ms</strong></div></div></section>}
    <div className="settings-layout">
      <section className="panel form-panel"><div className="panel-heading"><div><h3>DeepSeek Provider</h3><span>默认经济模式：deepseek-v4-flash / Thinking Off</span></div><button className={`toggle ${enabled ? "on" : ""}`} onClick={() => { save("deepseekEnabled", !enabled); save("provider", !enabled ? "deepseek" : "mock"); }}><span /></button></div>
        <label>API Key<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={settings.apiKeyConfigured ? "已配置，输入新 Key 可覆盖" : "在软件内输入 DeepSeek API Key"} /><button className="secondary-button" onClick={() => void saveKey()}>保存密钥</button></label>
        <div className={`notice ${settings.deepseekCredentialStatus === "DecryptFailed" || settings.deepseekCredentialStatus === "Invalid" || settings.deepseekCredentialStatus === "ExpiredOrRejected" ? "error" : ""}`}>凭据状态：{credentialStatusText(String(settings.deepseekCredentialStatus ?? (settings.apiKeyConfigured ? "Configured" : "NotConfigured")))}{settings.deepseekCredentialStatus === "DecryptFailed" && <span> 已保存的 DeepSeek 凭据无法在当前 Windows 用户环境中解密，请重新输入 API Key。</span>}{settings.lastTestedAt ? ` · 最近测试 ${String(settings.lastTestStatus ?? "unknown")}` : ""}</div>
        <label>模型<input value={String(settings.deepseekModel ?? "deepseek-v4-flash")} onChange={(event) => save("deepseekModel", event.target.value)} placeholder="例如 deepseek-chat" /></label>
        <label>生成模式<select value={quality ? "quality" : "economy"} onChange={(event) => save("deepseekGenerationMode", event.target.value)}><option value="economy">经济模式 · Thinking Off</option><option value="quality">高质量模式 · Thinking On</option></select></label>
        <div className="two-fields"><label>Input cost / 1K USD<input type="number" min="0" step="0.000001" value={Number(settings.deepseekInputCostPer1k ?? 0)} onChange={(event) => save("deepseekInputCostPer1k", Number(event.target.value))} /></label><label>Output cost / 1K USD<input type="number" min="0" step="0.000001" value={Number(settings.deepseekOutputCostPer1k ?? 0)} onChange={(event) => save("deepseekOutputCostPer1k", Number(event.target.value))} /></label></div>
      </section>
      <section className="panel form-panel"><div className="panel-heading"><div><h3>高级设置</h3><span>普通用户可保持默认值</span></div></div>
        <label>Base URL<input value={String(settings.deepseekBaseUrl ?? "https://api.deepseek.com")} onChange={(event) => save("deepseekBaseUrl", event.target.value)} /></label>
        <div className="two-fields"><label>并发数<input type="number" min="1" max="20" value={Number(settings.concurrency ?? 5)} onChange={(event) => save("concurrency", Number(event.target.value))} /></label><label>最大输出 tokens<input type="number" min="128" max="32000" value={Number(settings.maxOutputTokens ?? 3000)} onChange={(event) => save("maxOutputTokens", Number(event.target.value))} /></label></div>
        <div className="two-fields"><label>Timeout（毫秒）<input type="number" min="1000" max="300000" value={Number(settings.timeout ?? 30000)} onChange={(event) => save("timeout", Number(event.target.value))} /></label><label>Retry<input type="number" min="0" max="5" value={Number(settings.retry ?? 3)} onChange={(event) => save("retry", Number(event.target.value))} /></label></div>
        <div className="hint-box">请求日志只记录 Provider、Model、耗时、Token、状态和错误码，不记录 API Key、Authorization 或完整品牌 Prompt。</div>
      </section>
    </div>
  </>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }): JSX.Element { return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>; }

function credentialStatusText(status: string): string {
  return ({ NotConfigured: "未配置", Configured: "已配置", DecryptFailed: "解密失败", Validated: "已验证", Invalid: "无效", ExpiredOrRejected: "已过期或被拒绝" } as Record<string, string>)[status] ?? "未检测";
}
