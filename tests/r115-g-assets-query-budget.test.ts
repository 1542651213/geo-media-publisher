import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { OperationsAssets } from "../apps/desktop/src/main/operations-assets";

it("reads article and job history once for an image list and preserves exact usage", () => {
  const dir=mkdtempSync(join(tmpdir(),"r115-g-assets-budget-"));
  const {db,repository}=openDatabase(join(dir,"db"),join(process.cwd(),"packages/db/migrations"));
  try {
    repository.seedPlatformCatalog(join(process.cwd(),"PLATFORMS.csv"));
    const company=repository.createBrand({name:"合成甲",companyName:"合成甲企业"});
    const file=join(dir,"tiny.png");writeFileSync(file,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rZsAAAAASUVORK5CYII=","base64"));
    const assets=Array.from({length:30},(_,i)=>repository.createImageAsset({brandId:company.id,name:"合成"+i,filePath:file,originalFileName:"tiny.png",mimeType:"image/png",size:68}));
    const article=repository.createArticle({brandId:company.id,topic:"素材",keyword:"",city:"",title:"合成使用记录",body:"合成正文",summary:"",tags:[],seoKeywords:[],articleType:"article",aiProvider:"manual",aiModel:"manual",generatedAt:new Date().toISOString(),reusePolicy:"once",contentHash:"budget-fixture"})!;
    repository.attachCover(article.id,assets[0]!.id);
    const account=repository.createAccount({platformKey:"weibo",name:"合成账号"});
    db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,max_attempts,created_at,selected_image_asset_id) VALUES(?,?,'weibo',?,'2026-10-02','Cancelled',1,?,?)").run("older",account.id,article.id,"2026-10-01",assets[0]!.id);
    db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,max_attempts,created_at,selected_image_asset_id) VALUES(?,?,'toutiao',?,'2026-10-02','NeedsReconciliation',1,?,?)").run("newer",account.id,article.id,"2026-10-02",assets[0]!.id);
    const frozen=JSON.stringify(repository.listJobs());
    const jobs=vi.spyOn(repository,"listJobs"),articles=vi.spyOn(repository,"listArticles");
    const rows=new OperationsAssets(repository,join(dir,"managed")).list(company.id);
    expect(rows).toHaveLength(30);
    expect(rows.find(row=>row.id===assets[0]!.id)).toMatchObject({usedByArticleCount:1,usedByJobCount:2,lastUsedPlatform:"toutiao",lastUsedAt:"2026-10-02",width:1,height:1});
    expect(rows.find(row=>row.id===assets[1]!.id)).toMatchObject({usedByArticleCount:0,usedByJobCount:0,lastUsedPlatform:null});
    expect(jobs.mock.calls.length).toBeLessThanOrEqual(1);
    expect(articles.mock.calls.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(repository.listJobs())).toBe(frozen);
  } finally {vi.restoreAllMocks();db.close();rmSync(dir,{recursive:true,force:true});}
});
