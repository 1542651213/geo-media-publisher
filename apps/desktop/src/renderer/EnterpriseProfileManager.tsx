import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { BRAND_KNOWLEDGE_CATEGORIES, CORE_AI_FABRICATION_RULES, type Brand, type BrandKnowledgeCategory, type BrandKnowledgeEntry } from "@publisher/domain";

type EnterpriseView = "profile" | "knowledge";

interface ProfileDraft {
  name: string;
  companyName: string;
  description: string;
  industry: string;
  address: string;
  contactText: string;
  officialWebsite: string;
  notes: string;
  customRules: string;
}

const emptyDraft: ProfileDraft = { name: "", companyName: "", description: "", industry: "", address: "", contactText: "", officialWebsite: "", notes: "", customRules: "" };

export function EnterpriseProfileManager({ initialView, refresh, onNavigate }: { initialView: EnterpriseView; refresh: () => void; onNavigate: (route: "production" | "brand" | "knowledge") => void }): JSX.Element {
  const [view, setView] = useState<EnterpriseView>(initialView);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [businesses, setBusinesses] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [knowledge, setKnowledge] = useState<BrandKnowledgeEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = brands.find((brand) => brand.id === brandId) ?? null;

  const applyBrand = (brand: Brand, entries?: BrandKnowledgeEntry[]): void => {
    setBrandId(brand.id);
    setDraft({
      name: brand.name,
      companyName: brand.companyName,
      description: brand.description,
      industry: brand.industry ?? "",
      address: brand.address,
      contactText: formatContact(brand.contact),
      officialWebsite: brand.officialWebsite ?? "",
      notes: brand.notes ?? "",
      customRules: brand.aiForbiddenClaims.filter((rule) => !CORE_AI_FABRICATION_RULES.includes(rule as typeof CORE_AI_FABRICATION_RULES[number])).join("\n")
    });
    setBusinesses(splitList(brand.mainBusiness));
    setRegions(brand.serviceRegions);
    setKnowledge(entries ?? brand.knowledgeEntries ?? []);
  };

  const reload = async (preferredId?: string): Promise<void> => {
    const nextBrands = await window.publisherAPI.brands.list();
    setBrands(nextBrands);
    const next = nextBrands.find((brand) => brand.id === (preferredId ?? brandId)) ?? nextBrands[0];
    if (!next) return;
    const entries = await window.publisherAPI.brandKnowledge.list(next.id);
    applyBrand(next, entries);
  };

  // The editor intentionally performs its first database load only when this route mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, []);
  useEffect(() => { setView(initialView); }, [initialView]);

  const switchBrand = async (nextId: string): Promise<void> => {
    const next = brands.find((brand) => brand.id === nextId);
    if (!next) return;
    const entries = await window.publisherAPI.brandKnowledge.list(next.id);
    applyBrand(next, entries);
    setMessage("");
  };

  const saveProfile = async (): Promise<void> => {
    if (!current || !draft.companyName.trim() || !draft.name.trim()) return;
    setBusy(true);
    try {
      const saved = await window.publisherAPI.brands.update(current.id, {
        name: draft.name.trim(),
        companyName: draft.companyName.trim(),
        description: draft.description.trim(),
        industry: draft.industry.trim(),
        address: draft.address.trim(),
        contact: parseContact(draft.contactText),
        officialWebsite: draft.officialWebsite.trim(),
        mainBusiness: businesses.join("、"),
        serviceRegions: regions,
        notes: draft.notes.trim(),
        aiForbiddenClaims: [...CORE_AI_FABRICATION_RULES, ...splitLines(draft.customRules)]
      });
      setBrands((items) => items.map((item) => item.id === saved.id ? saved : item));
      applyBrand(saved, knowledge);
      setMessage("企业资料已保存");
      refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "企业资料保存失败"); }
    finally { setBusy(false); }
  };

  if (!current) return <section className="panel enterprise-empty"><h2>还没有企业资料</h2><p>请先在高级功能中创建企业，再回到内容生产。</p></section>;

  return <>
    <div className="page-title enterprise-page-title"><div><div className="eyebrow">内容生产 / 企业资料</div><h2>{view === "profile" ? "企业资料" : "企业知识库"}</h2><p>{view === "profile" ? "维护稳定的企业基础信息，下一次内容生成会立即使用最新资料。" : "按业务语言管理可扩展事实材料，不显示技术字段。"}</p></div><button className="secondary-button" onClick={() => onNavigate("production")}>返回内容生产</button></div>
    <section className="panel enterprise-context-bar">
      <div><span>当前企业</span><strong>{current.companyName}</strong><small>最近更新：{formatDate(latestUpdate(current, knowledge))}</small></div>
      {brands.length > 1 && <label>切换企业<select value={brandId} onChange={(event) => void switchBrand(event.target.value)}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label>}
      <div className="enterprise-tabs"><button className={view === "profile" ? "active" : ""} onClick={() => { setView("profile"); onNavigate("brand"); }}>企业资料</button><button className={view === "knowledge" ? "active" : ""} onClick={() => { setView("knowledge"); onNavigate("knowledge"); }}>企业知识库</button></div>
    </section>
    {message && <div className={`notice ${message.includes("失败") ? "error" : "success"}`}>{message}</div>}
    {view === "profile" ? <ProfileEditor draft={draft} setDraft={setDraft} businesses={businesses} setBusinesses={setBusinesses} regions={regions} setRegions={setRegions} busy={busy} onSave={saveProfile} /> : <KnowledgeEditor brandId={current.id} entries={knowledge} setMessage={setMessage} onChanged={() => reload(current.id)} />}
  </>;
}

function ProfileEditor({ draft, setDraft, businesses, setBusinesses, regions, setRegions, busy, onSave }: { draft: ProfileDraft; setDraft: (draft: ProfileDraft) => void; businesses: string[]; setBusinesses: (items: string[]) => void; regions: string[]; setRegions: (items: string[]) => void; busy: boolean; onSave: () => Promise<void> }): JSX.Element {
  const field = (key: keyof ProfileDraft, label: string, multiline = false, placeholder = ""): JSX.Element => <label>{label}{multiline ? <textarea rows={4} value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <input value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}</label>;
  return <div className="enterprise-profile-layout">
    <section className="panel form-panel enterprise-base-form"><div className="panel-heading"><div><h3>基础信息</h3><span>企业资料用于稳定身份与生成上下文</span></div></div>
      <div className="two-fields">{field("companyName", "企业名称")}{field("name", "企业简称")}</div>
      {field("description", "企业介绍", true, "介绍企业定位、能力和服务对象")}
      <div className="two-fields">{field("industry", "所属行业", false, "例如：环保治理")}{field("officialWebsite", "官网", false, "https://")}</div>
      {field("address", "地址")}{field("contactText", "联系方式", true, "每行一项，例如：电话：0512-xxxx")}{field("notes", "企业备注", true)}
    </section>
    <div className="enterprise-list-column">
      <EditableList title="主营业务" hint="Content Studio 会直接读取这些业务" addLabel="添加业务" items={businesses} onChange={setBusinesses} />
      <EditableList title="服务区域" hint="新增后会立即出现在内容生产的地区选择中" addLabel="添加地区" items={regions} onChange={setRegions} sortable={false} />
    </div>
    <section className="panel enterprise-ai-rules"><div className="panel-heading"><div><h3>AI 内容规则</h3><span>继续复用现有 Quality Gate 与企业事实边界</span></div></div><h4>禁止编造</h4><div className="rule-chip-list">{CORE_AI_FABRICATION_RULES.map((rule) => <span key={rule}>{rule.replace("禁止编造", "")}</span>)}</div><label>禁止使用的宣传词<textarea rows={5} value={draft.customRules} onChange={(event) => setDraft({ ...draft, customRules: event.target.value })} placeholder={"每行一条，例如：\n第一\n最好\n100%\n永久有效"} /></label></section>
    <div className="enterprise-save-bar"><span>保存后会明确提示，并在下次生成时生效。</span><button className="primary-button" disabled={busy || !draft.companyName.trim() || !draft.name.trim()} onClick={() => void onSave()}>{busy ? "保存中…" : "保存"}</button></div>
  </div>;
}

function EditableList({ title, hint, addLabel, items, onChange, sortable = true }: { title: string; hint: string; addLabel: string; items: string[]; onChange: (items: string[]) => void; sortable?: boolean }): JSX.Element {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const addOrSave = (): void => {
    const next = value.trim();
    if (!next) return;
    if (editing === null) onChange([...items.filter((item) => item !== next), next]);
    else onChange(items.map((item, index) => index === editing ? next : item).filter((item, index, all) => all.indexOf(item) === index));
    setValue(""); setEditing(null);
  };
  const move = (index: number, offset: number): void => { const target = index + offset; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target] as string, next[index] as string]; onChange(next); };
  return <section className="panel enterprise-list-editor"><div className="panel-heading"><div><h3>{title}</h3><span>{hint}</span></div></div><div className="enterprise-list-items">{items.length === 0 ? <p className="muted">暂未添加</p> : items.map((item, index) => <div key={`${item}-${index}`}><strong>{item}</strong><div>{sortable && <><button className="mini-button" disabled={index === 0} onClick={() => move(index, -1)}>上移</button><button className="mini-button" disabled={index === items.length - 1} onClick={() => move(index, 1)}>下移</button></>}<button className="mini-button" onClick={() => { setEditing(index); setValue(item); }}>编辑</button><button className="mini-button danger-mini" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除</button></div></div>)}</div><div className="inline-form"><input value={value} placeholder={addLabel} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addOrSave(); }} /><button className="secondary-button" onClick={addOrSave}>{editing === null ? `＋ ${addLabel}` : "保存修改"}</button>{editing !== null && <button className="text-button" onClick={() => { setEditing(null); setValue(""); }}>取消</button>}</div></section>;
}

function KnowledgeEditor({ brandId, entries, setMessage, onChanged }: { brandId: string; entries: BrandKnowledgeEntry[]; setMessage: (message: string) => void; onChanged: () => Promise<void> }): JSX.Element {
  const [category, setCategory] = useState<BrandKnowledgeCategory>("service_item");
  const [filter, setFilter] = useState<BrandKnowledgeCategory | "all">("all");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => entries.filter((entry) => filter === "all" || entry.category === filter), [entries, filter]);
  const reset = (): void => { setEditingId(null); setCategory("service_item"); setTitle(""); setContent(""); };
  const save = async (): Promise<void> => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      if (editingId) await window.publisherAPI.brandKnowledge.update(editingId, { category, title, content });
      else await window.publisherAPI.brandKnowledge.create({ brandId, category, title, content, enabled: true });
      setMessage(editingId ? "知识资料已更新" : "知识资料已新增"); reset(); await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "知识资料保存失败"); }
    finally { setBusy(false); }
  };
  const toggle = async (entry: BrandKnowledgeEntry): Promise<void> => { await window.publisherAPI.brandKnowledge.update(entry.id, { enabled: !entry.enabled }); setMessage(entry.enabled ? "知识资料已停用" : "知识资料已启用"); await onChanged(); };
  const remove = async (entry: BrandKnowledgeEntry): Promise<void> => { if (!window.confirm(`确定删除“${entry.title}”吗？`)) return; await window.publisherAPI.brandKnowledge.delete(entry.id); setMessage("知识资料已删除"); if (editingId === entry.id) reset(); await onChanged(); };
  return <div className="enterprise-knowledge-layout">
    <section className="panel form-panel knowledge-editor"><div className="panel-heading"><div><h3>{editingId ? "编辑知识资料" : "新增知识资料"}</h3><span>企业资料是稳定基础信息；这里保存可扩展事实材料。</span></div></div><label>类别<select value={category} onChange={(event) => setCategory(event.target.value as BrandKnowledgeCategory)}>{BRAND_KNOWLEDGE_CATEGORIES.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：苏州办公室甲醛治理流程" /></label><label>内容<textarea rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder="填写可核验、可用于内容生产的事实资料" /></label><div className="drawer-footer"><button className="secondary-button" onClick={reset}>清空</button><button className="primary-button" disabled={busy || !title.trim() || !content.trim()} onClick={() => void save()}>{busy ? "保存中…" : editingId ? "保存修改" : "新增资料"}</button></div></section>
    <section className="panel knowledge-library"><div className="panel-heading"><div><h3>知识资料</h3><span>共 {entries.length} 条，启用 {entries.filter((entry) => entry.enabled).length} 条</span></div><select value={filter} onChange={(event) => setFilter(event.target.value as BrandKnowledgeCategory | "all")}><option value="all">全部类别</option>{BRAND_KNOWLEDGE_CATEGORIES.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></div>{shown.length === 0 ? <div className="empty-state compact"><strong>这个类别还没有资料</strong><span>从左侧新增后会显示在这里。</span></div> : <div className="knowledge-card-list">{shown.map((entry) => <article className={entry.enabled ? "" : "disabled"} key={entry.id}><div><span className="status-chip">{categoryLabel(entry.category)}</span><span className={`status-chip ${entry.enabled ? "success" : "muted"}`}>{entry.enabled ? "已启用" : "已停用"}</span></div><h4>{entry.title}</h4><p>{summary(entry.content)}</p><small>更新于 {formatDate(entry.updatedAt)}</small><div className="row-actions"><button className="mini-button" onClick={() => { setEditingId(entry.id); setCategory(entry.category); setTitle(entry.title); setContent(entry.content); }}>编辑</button><button className="mini-button" onClick={() => void toggle(entry)}>{entry.enabled ? "停用" : "启用"}</button><button className="mini-button danger-mini" onClick={() => void remove(entry)}>删除</button></div></article>)}</div>}</section>
  </div>;
}

function splitList(value: string): string[] { return [...new Set(value.split(/[、,，；;|\n]+/u).map((item) => item.trim()).filter(Boolean))]; }
function splitLines(value: string): string[] { return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))]; }
function formatContact(contact: Record<string, string>): string { return Object.entries(contact).filter(([, value]) => value.trim()).map(([key, value]) => `${key}：${value}`).join("\n"); }
function parseContact(value: string): Record<string, string> { return Object.fromEntries(splitLines(value).map((line, index) => { const match = line.match(/^([^:：]+)[:：](.*)$/u); return match ? [match[1]?.trim() || `联系方式${index + 1}`, match[2]?.trim() || ""] : [`联系方式${index + 1}`, line]; })); }
function categoryLabel(category: BrandKnowledgeCategory): string { return BRAND_KNOWLEDGE_CATEGORIES.find((item) => item.key === category)?.label ?? "其他资料"; }
function summary(content: string): string { return content.length > 140 ? `${content.slice(0, 140)}…` : content; }
function latestUpdate(brand: Brand, entries: BrandKnowledgeEntry[]): string { return [brand.updatedAt, ...entries.map((entry) => entry.updatedAt)].sort().at(-1) ?? brand.updatedAt; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
