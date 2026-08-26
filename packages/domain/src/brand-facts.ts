import type { Brand, BrandKnowledgeCategory, BrandKnowledgeEntry } from "./types";

export const BRAND_KNOWLEDGE_CATEGORIES: ReadonlyArray<{ key: BrandKnowledgeCategory; label: string }> = [
  { key: "company_profile", label: "企业介绍" },
  { key: "service_item", label: "服务项目" },
  { key: "service_process", label: "服务流程" },
  { key: "service_area", label: "服务区域" },
  { key: "enterprise_advantage", label: "企业优势" },
  { key: "qualification_certificate", label: "资质证书" },
  { key: "patent", label: "专利" },
  { key: "equipment", label: "设备" },
  { key: "case", label: "案例" },
  { key: "team", label: "团队" },
  { key: "contact", label: "联系方式" },
  { key: "other_material", label: "其他资料" }
];

export const CORE_AI_FABRICATION_RULES = [
  "禁止编造资质",
  "禁止编造排名",
  "禁止编造认证",
  "禁止编造案例",
  "禁止编造数据",
  "禁止编造专利",
  "禁止编造服务区域",
  "禁止编造效果承诺"
] as const;

export const BRAND_FACT_TYPES = [
  "company_profile",
  "business",
  "service_area",
  "qualification",
  "equipment",
  "case",
  "service_process",
  "faq",
  "advantage",
  "contact"
] as const;
export type BrandFactType = (typeof BRAND_FACT_TYPES)[number];

export interface BrandFact {
  id: string;
  type: BrandFactType;
  label: string;
  content: string;
  terms: string[];
}

export interface BrandFactQuery {
  business: string;
  city: string;
  keyword: string;
  topic: string;
}

export interface KnowledgeSnapshot {
  version: "v0.9.3.1" | "v0.9.3.3";
  brandId: string;
  query: BrandFactQuery;
  factCount: number;
  selectedFactTypes: BrandFactType[];
  facts: BrandFact[];
  selectedAt: string;
}

const separators = /[、,，；;|/\n]+/u;

function splitTerms(value: string): string[] {
  return [...new Set(value.split(separators).map((item) => item.trim()).filter((item) => item.length >= 2))];
}

function makeFact(brandId: string, type: BrandFactType, label: string, content: string, terms: string[] = []): BrandFact | null {
  const normalized = content.trim();
  if (!normalized) return null;
  return { id: `${brandId}:${type}:${label}`, type, label, content: normalized, terms: [...new Set([...terms, ...splitTerms(normalized)])] };
}

export function extractBrandFacts(brand: Brand): BrandFact[] {
  const facts: BrandFact[] = [];
  const add = (fact: BrandFact | null): void => { if (fact) facts.push(fact); };
  add(makeFact(brand.id, "company_profile", "企业介绍", brand.description, [brand.name, brand.companyName]));
  for (const business of splitTerms(brand.mainBusiness)) add(makeFact(brand.id, "business", `业务：${business}`, business, [business]));
  for (const city of brand.serviceRegions) add(makeFact(brand.id, "service_area", `服务区域：${city}`, city, [city]));
  const contact = Object.entries(brand.contact).filter(([, value]) => value.trim()).map(([key, value]) => `${key}：${value}`).join("；");
  add(makeFact(brand.id, "contact", "联系方式", contact));
  if (brand.knowledgeEntries === undefined) {
    add(makeFact(brand.id, "advantage", "企业特点", brand.advantages.join("；")));
    add(makeFact(brand.id, "service_process", "服务流程", brand.serviceProcess));
    add(makeFact(brand.id, "service_process", "售后边界", brand.afterSales));
    add(makeFact(brand.id, "qualification", "资质与证书", brand.certificates));
    add(makeFact(brand.id, "qualification", "专利说明", brand.patents));
    add(makeFact(brand.id, "equipment", "设备说明", brand.equipment));
    add(makeFact(brand.id, "case", "案例说明", brand.cases));
    add(makeFact(brand.id, "faq", "常见问题", brand.faq));
  } else {
    for (const entry of brand.knowledgeEntries.filter((item) => item.enabled)) add(knowledgeEntryFact(entry));
  }
  return facts.filter((fact, index, all) => all.findIndex((item) => item.type === fact.type && item.content === fact.content) === index);
}

const knowledgeFactType: Record<BrandKnowledgeCategory, BrandFactType> = {
  company_profile: "company_profile",
  service_item: "business",
  service_process: "service_process",
  service_area: "service_area",
  enterprise_advantage: "advantage",
  qualification_certificate: "qualification",
  patent: "qualification",
  equipment: "equipment",
  case: "case",
  team: "advantage",
  contact: "contact",
  other_material: "faq"
};

function knowledgeEntryFact(entry: BrandKnowledgeEntry): BrandFact | null {
  const type = knowledgeFactType[entry.category];
  const fact = makeFact(entry.brandId, type, entry.title, entry.content, [entry.title]);
  return fact ? { ...fact, id: entry.id } : null;
}

function scoreFact(fact: BrandFact, query: BrandFactQuery): number {
  const queryText = [query.business, query.city, query.keyword, query.topic].join(" ").trim();
  if (!queryText) return fact.type === "company_profile" ? 10 : 0;
  let score = 0;
  if (query.city && (fact.content.includes(query.city) || fact.terms.some((term) => term === query.city))) score += fact.type === "service_area" ? 24 : 8;
  for (const term of fact.terms) {
    if (term.length >= 2 && queryText.includes(term)) score += fact.type === "business" ? 24 : 7;
  }
  if (query.business && fact.content.includes(query.business)) score += fact.type === "business" ? 30 : 10;
  if (query.keyword && fact.content.includes(query.keyword)) score += 10;
  if (fact.type === "company_profile") score += 6;
  if (fact.type === "service_process") score += 5;
  return score;
}

export function selectRelevantBrandFacts(brand: Brand, query: BrandFactQuery, maxFacts = 8): KnowledgeSnapshot {
  const facts = extractBrandFacts(brand);
  const scored = facts.map((fact, index) => ({ fact, score: scoreFact(fact, query), index }));
  const relevant = scored.filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index).map((item) => item.fact);
  const selected: BrandFact[] = [];
  const addType = (type: BrandFactType): void => {
    const fact = relevant.find((item) => item.type === type && !selected.some((current) => current.id === item.id));
    if (fact && selected.length < maxFacts) selected.push(fact);
  };
  addType("company_profile");
  addType("business");
  addType("service_area");
  addType("service_process");
  for (const fact of relevant) {
    if (selected.length >= maxFacts) break;
    if (!selected.some((current) => current.id === fact.id)) selected.push(fact);
  }
  if (selected.length === 0) selected.push(...facts.slice(0, maxFacts));
  return {
    version: "v0.9.3.3",
    brandId: brand.id,
    query,
    factCount: selected.length,
    selectedFactTypes: [...new Set(selected.map((fact) => fact.type))],
    facts: selected,
    selectedAt: new Date().toISOString()
  };
}
