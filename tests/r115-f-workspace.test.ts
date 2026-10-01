import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { CompanyWorkspace } from "../apps/desktop/src/main/company-workspace";

it("scopes Main reads, persists workspace, and rejects stale cross-company writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-f-"));
  const { db, repository } = openDatabase(join(dir, "db"), join(process.cwd(), "packages/db/migrations"));
  try {
    const a = repository.createBrand({ name: "甲", companyName: "甲企业" }), b = repository.createBrand({ name: "乙", companyName: "乙企业" });
    const accounts = new Map([["a", a.id], ["b", b.id]]);
    const workspace = new CompanyWorkspace(repository, id => accounts.get(id) ?? null);
    workspace.select(a.id);
    expect(workspace.current()).toBe(a.id);
    expect(workspace.scoped({ search: "流程" })).toEqual({ search: "流程", brandId: a.id });
    expect(workspace.accountAllowed("a")).toBe(true);
    workspace.select(b.id);
    expect(workspace.accountAllowed("a")).toBe(false);
    expect(() => workspace.assertCompany(a.id)).toThrow();
    expect(() => workspace.scoped({ brandId: a.id })).toThrow();
    expect(new CompanyWorkspace(repository, id => accounts.get(id) ?? null).current()).toBe(b.id);
    expect(() => workspace.select("missing")).toThrow();
    expect(workspace.prepare("articles:list", { search: "流程" })).toEqual({ search: "流程", brandId: b.id });
    expect(() => workspace.prepare("ai-center:context", { companyId: a.id })).toThrow();
    expect(() => workspace.prepare("operations:save-fact", { companyId: a.id })).toThrow();
    expect(() => workspace.prepare("brands:update", { id: a.id, data: { name: "错公司" } })).toThrow();
    expect(() => workspace.prepare("articles:excel-confirm", { preview: { rows: [{ matchedBrandId: a.id }] } })).toThrow();
    expect(() => workspace.prepare("accounts:update", { id: "a", data: { accountAlias: "错账号" } })).toThrow();
    const keyword = repository.createKeywordTemplate({ brandId: a.id, template: "隔离", category: "test" });
    expect(() => workspace.prepare("keywords:delete-template", { id: keyword.id })).toThrow();
    const knowledge = repository.listBrandKnowledgeEntries(a.id)[0];
    if (knowledge) expect(() => workspace.prepare("brand-knowledge:update", { id: knowledge.id, data: { title: "错公司" } })).toThrow();
    expect(() => workspace.prepare("accounts:check-login", { accountId: "a", platformKey: "weibo" })).toThrow();
    expect(workspace.prepare("accounts:check-login", { accountId: "b", platformKey: "weibo" })).toEqual({ accountId: "b", platformKey: "weibo" });
    expect(repository.listJobs()).toEqual([]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
