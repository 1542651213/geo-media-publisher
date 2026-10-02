import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { openDatabase } from '@publisher/db';
import { AdapterRegistry,type BrowserSessionManager,type AccountSessionTarget,type PlatformAdapter } from '@publisher/adapters-core';
import { TestPlatformAdapter } from '@publisher/adapters-test';
import { createConsoleLogger } from '@publisher/logger';
import { PersistentScheduler,PublisherService } from '@publisher/publisher';
import { AccountSessionRehydrationCoordinator } from '../apps/desktop/src/main/account-session-rehydration';
const roots:string[]=[];
afterEach(()=>{vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('runs the normal Scheduler timer and recovery with batch closed while independent account sessions recover',async()=>{
  vi.useFakeTimers();const root=mkdtempSync(join(tmpdir(),'r115-g-normal-scheduler-'));roots.push(root);const {repository,db}=openDatabase(join(root,'publisher.db'),resolve('packages/db/migrations'));const logger=createConsoleLogger();let scheduler:PersistentScheduler|undefined;
  try{
    repository.seedPlatformCatalog(resolve('PLATFORMS.csv'));repository.db.prepare("INSERT OR IGNORE INTO platforms(id,platform_key,display_name,category) VALUES('synthetic-platform','test','合成测试','test')").run();
    const company=repository.createBrand({name:'合成调度公司',companyName:'合成调度公司有限公司'}),account=repository.createAccount({platformKey:'test',name:'合成调度账号'}),disabled=repository.createAccount({platformKey:'test',name:'手动停用账号'});repository.updateAccount(disabled.id,{enabled:false});
    const article=repository.createArticle({brandId:company.id,title:'合成调度文章',body:'合成调度测试资料',topic:'测试',keyword:'测试',city:'',summary:'',tags:[],seoKeywords:[],articleType:'article',aiProvider:'manual',aiModel:'fixture',generatedAt:'fixture',reusePolicy:'once',contentHash:'synthetic-scheduler'});if(!article)throw new Error('fixture required');
    db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at) VALUES('unknown-final',?,'test',?,'2000-01-01','NeedsReconciliation','fixture')").run(account.id,article.id);
    db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at,final_submit_count,payload_hash) VALUES('unknown-intent','unknown-final',?,?,'test',1,'Unknown','fixture','fixture',1,'frozen')").run(account.id,article.id);
    db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at) VALUES('due-but-batch-off',?,'test',?,'2000-01-01','Scheduled','fixture')").run(account.id,article.id);
    const frozen=JSON.stringify([db.prepare("SELECT * FROM publish_jobs WHERE id='unknown-final'").get(),db.prepare("SELECT * FROM submission_intents").all()]);
    const adapter=new TestPlatformAdapter(),publish=vi.spyOn(adapter,'publishArticle'),login=vi.spyOn(adapter,'checkLogin');const registry=new AdapterRegistry();registry.register(adapter);const publisher=new PublisherService(repository,registry,logger);
    scheduler=new PersistentScheduler(repository,publisher,logger,100,{allowAccountLoginSweep:()=>false,allowScheduledJob:()=>false});scheduler.start();await vi.advanceTimersByTimeAsync(500);
    expect(publish).not.toHaveBeenCalled();expect(login).not.toHaveBeenCalled();expect(repository.getJob('due-but-batch-off')?.status).toBe('Scheduled');expect(JSON.stringify([db.prepare("SELECT * FROM publish_jobs WHERE id='unknown-final'").get(),db.prepare('SELECT * FROM submission_intents').all()])).toBe(frozen);
    let offline=true;const browser={manifest:{transport:'browser'},checkLogin:async()=>{if(offline)throw Object.assign(new Error('synthetic offline'),{code:'NETWORK_ERROR'});return 'logged_in';},getAccountProfile:async()=>({accountId:'synthetic-identity'})} as unknown as PlatformAdapter;
    const target=(id:string):AccountSessionTarget=>({accountId:id,accountName:'合成账号',companyId:company.id,platformKey:'weibo',connectionMode:'BrowserAutomation',enabled:repository.getAccountById(id)?.enabled??false,expectedRemoteIdentity:'synthetic-identity',loginGeneration:1});
    const coordinator=new AccountSessionRehydrationCoordinator({registry:{tryGetForConnection:()=>browser},browserSessions:{restore:async()=>({})} as unknown as BrowserSessionManager,resolveCompanyId:()=>company.id,resolveAuthoritativeTarget:id=>target(id)});
    const unavailable=await coordinator.refresh(target(account.id));expect(unavailable.state).toBe('NETWORK_UNAVAILABLE');expect(repository.getAccountById(account.id)?.enabled).toBe(true);expect(repository.getAccountById(account.id)?.loginStatus).not.toBe('expired');
    offline=false;expect((await coordinator.refresh(target(account.id))).state).toBe('AUTHENTICATED');expect((await coordinator.refresh(target(disabled.id))).state).toBe('DISABLED');await vi.advanceTimersByTimeAsync(200);expect(publish).not.toHaveBeenCalled();expect(repository.getAccountById(disabled.id)?.enabled).toBe(false);
  }finally{scheduler?.stop();db.close();}
});
