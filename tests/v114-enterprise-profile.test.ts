import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_AI_FABRICATION_RULES, selectRelevantBrandFacts } from "@publisher/domain";
import { openDatabase, runMigrations } from "@publisher/db";

const migrationsDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open !== false) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(name: string): string { const dir = mkdtempSync(join(tmpdir(), `publisher-v114-${name}-`)); tempDirs.push(dir); return dir; }

describe("V1.1.4 enterprise profile editor restore", () => {
  it("upgrades an existing enterprise in place without reseeding or duplicating it", () => {
    const dir = temp("upgrade");
    const oldMigrations = join(dir, "old-migrations");
    mkdirSync(oldMigrations);
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && !name.startsWith("0019_"))) copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
    const databasePath = join(dir, "publisher.db");
    const legacy = new Database(databasePath);
    runMigrations(legacy, oldMigrations);
    legacy.prepare("INSERT INTO brands (id,name,company_name,description,main_business,service_regions_json,advantages_json,contact_json,established_at,address,service_process,after_sales,faq,certificates,patents,equipment,cases,ai_forbidden_claims_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("existing-enterprise", "康一环保", "江苏康一环保科技有限公司", "旧版企业介绍", "甲醛治理、定期消杀", JSON.stringify(["江苏", "苏州"]), JSON.stringify(["本地服务流程清晰"]), JSON.stringify({ phone: "0512-test" }), "", "苏州", "现场评估后确认方案", "以双方约定为准", "服务前先沟通需求", "已有资质资料", "已有专利资料", "已有设备资料", "已有案例资料", JSON.stringify(["禁止虚构客户名称"]), "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z");
    legacy.close();

    const opened = openDatabase(databasePath, migrationsDir); databases.push(opened.db);
    const brands = opened.repository.listBrands();
    expect(brands).toHaveLength(1);
    expect(brands[0]).toMatchObject({ id: "existing-enterprise", companyName: "江苏康一环保科技有限公司", description: "旧版企业介绍", mainBusiness: "甲醛治理、定期消杀", serviceRegions: ["江苏", "苏州"] });
    expect(brands[0]?.knowledgeEntries?.map((entry) => entry.title)).toEqual(expect.arrayContaining(["服务流程", "资质证书", "专利", "设备", "案例"]));
    expect(opened.db.prepare("SELECT COUNT(*) count FROM brands").get()).toEqual({ count: 1 });
    expect(opened.db.prepare("SELECT COUNT(*) count FROM migrations WHERE id='0019_v114_enterprise_profile_restore.sql'").get()).toEqual({ count: 1 });
  });

  it("persists profile fields, ordered businesses, service regions and retained AI rules", () => {
    const dir = temp("profile");
    const opened = openDatabase(join(dir, "publisher.db"), migrationsDir); databases.push(opened.db);
    const brand = opened.repository.createBrand({ name: "康一环保", companyName: "江苏康一环保科技有限公司", description: "旧介绍", mainBusiness: "甲醛治理", serviceRegions: ["江苏"], aiForbiddenClaims: ["第一"] });
    const updated = opened.repository.updateBrand(brand.id, { description: "最新企业介绍", industry: "环保治理", officialWebsite: "https://example.test", notes: "内部运营备注", mainBusiness: "甲醛治理、定期消杀、白蚁防治", serviceRegions: ["江苏", "苏州", "木渎", "吴中"], contact: { 电话: "0512-test" } });
    expect(updated).toMatchObject({ description: "最新企业介绍", industry: "环保治理", officialWebsite: "https://example.test", notes: "内部运营备注", mainBusiness: "甲醛治理、定期消杀、白蚁防治", serviceRegions: ["江苏", "苏州", "木渎", "吴中"], contact: { 电话: "0512-test" } });
    expect(updated.aiForbiddenClaims).toEqual(expect.arrayContaining([...CORE_AI_FABRICATION_RULES, "第一"]));
  });

  it("supports knowledge create, edit, disable and delete, and the next snapshot reads current data", () => {
    const dir = temp("knowledge");
    const opened = openDatabase(join(dir, "publisher.db"), migrationsDir); databases.push(opened.db);
    const brand = opened.repository.createBrand({ name: "康一环保", companyName: "江苏康一环保科技有限公司", description: "旧企业介绍", mainBusiness: "甲醛治理", serviceRegions: ["苏州"] });
    const entry = opened.repository.createBrandKnowledgeEntry({ brandId: brand.id, category: "equipment", title: "治理设备", content: "设备型号 A，用于现场治理" });
    opened.repository.updateBrand(brand.id, { description: "本次保存后的最新企业介绍", mainBusiness: "甲醛治理、定期消杀", serviceRegions: ["苏州", "木渎"] });
    const current = opened.repository.getBrand(brand.id);
    if (!current) throw new Error("enterprise missing");
    const snapshot = selectRelevantBrandFacts(current, { business: "甲醛治理", city: "木渎", keyword: "木渎甲醛治理", topic: "治理设备" });
    expect(snapshot.facts.map((fact) => fact.content)).toEqual(expect.arrayContaining(["本次保存后的最新企业介绍", "甲醛治理", "木渎", "设备型号 A，用于现场治理"]));

    const edited = opened.repository.updateBrandKnowledgeEntry(entry.id, { title: "治理设备资料", content: "设备型号 B，用于现场治理" });
    expect(edited).toMatchObject({ title: "治理设备资料", content: "设备型号 B，用于现场治理", enabled: true });
    expect(opened.repository.updateBrandKnowledgeEntry(entry.id, { enabled: false }).enabled).toBe(false);
    const disabledBrand = opened.repository.getBrand(brand.id);
    if (!disabledBrand) throw new Error("enterprise missing after disable");
    expect(selectRelevantBrandFacts(disabledBrand, { business: "", city: "", keyword: "设备型号 B", topic: "" }).facts.some((fact) => fact.content.includes("设备型号 B"))).toBe(false);
    opened.repository.deleteBrandKnowledgeEntry(entry.id);
    expect(opened.repository.listBrandKnowledgeEntries(brand.id).some((item) => item.id === entry.id)).toBe(false);
  });

  it("does not mutate an existing Zhihu browser session while enterprise data changes", () => {
    const dir = temp("session");
    const opened = openDatabase(join(dir, "publisher.db"), migrationsDir); databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const brand = opened.repository.createBrand({ name: "康一环保", companyName: "江苏康一环保科技有限公司" });
    const account = opened.repository.createAccount({ platformKey: "zhihu", name: "知乎现有账号" });
    opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "zhihu", browserSessionId: "zhihu-existing-session", externalAccountId: "zhihu-owner", lastVerifiedAt: "2026-08-24T00:00:00.000Z" });
    const before = opened.repository.listAccounts().find((item) => item.id === account.id);
    opened.repository.updateBrand(brand.id, { description: "资料编辑不会碰账号会话" });
    opened.repository.createBrandKnowledgeEntry({ brandId: brand.id, category: "service_item", title: "甲醛治理", content: "现场评估后确认治理范围" });
    expect(opened.repository.listAccounts().find((item) => item.id === account.id)).toEqual(before);
  });

  it("keeps the normal navigation simple and exposes business-facing enterprise UX", () => {
    const workspace = readFileSync(join(process.cwd(), "apps", "desktop", "src", "renderer", "V11Workspace.tsx"), "utf8");
    const editor = readFileSync(join(process.cwd(), "apps", "desktop", "src", "renderer", "EnterpriseProfileManager.tsx"), "utf8");
    expect(workspace).toContain("当前企业");
    expect(workspace).toContain("编辑企业资料");
    expect(workspace).toContain("管理企业知识库");
    expect(workspace).toContain("查看将使用的资料");
    expect(workspace).toContain("当前企业资料较少，AI生成内容可能偏通用。");
    expect(editor).toContain("企业资料已保存");
    expect(editor).toContain("主营业务");
    expect(editor).toContain("服务区域");
    expect(editor).toContain("禁止使用的宣传词");
    expect(editor).not.toContain("metadata_json");
    expect(editor).not.toContain("content hash");
  });
});
