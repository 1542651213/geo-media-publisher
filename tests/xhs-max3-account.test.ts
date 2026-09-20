import {mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {expect,it} from "vitest";
import {openDatabase} from "@publisher/db";
it("scoped live account registration preserves the approved local id without forging login or authorization",()=>{
 const dir=mkdtempSync(join(tmpdir(),"max3-account-"));const {db,repository}=openDatabase(join(dir,"db.sqlite"),join(process.cwd(),"packages/db/migrations"));
 try{
  repository.seedPlatformCatalog(join(process.cwd(),"PLATFORMS.csv"));
  const id="54b390ac-d81e-440a-baeb-d00f9f346cc3";
  const account=repository.registerScopedBrowserAccount({id,platformKey:"xiaohongshu",name:"江苏康一环保科技有限公司"});
  expect(account).toMatchObject({id,platformKey:"xiaohongshu",loginStatus:"unknown"});
  expect(repository.getAccountAuthorization(id,"xiaohongshu")).toBeNull();
  expect(repository.registerScopedBrowserAccount({id,platformKey:"xiaohongshu",name:"江苏康一环保科技有限公司"}).id).toBe(id);
  expect(()=>repository.registerScopedBrowserAccount({id,platformKey:"xiaohongshu",name:"Other"})).toThrow();
 }finally{db.close()}
});
