import { expect, it, vi } from "vitest";
import type { AccountSessionTarget, BrowserSessionManager, PlatformAdapter } from "@publisher/adapters-core";
import { AccountSessionRehydrationCoordinator } from "../apps/desktop/src/main/account-session-rehydration";
const target:AccountSessionTarget={accountId:'a',accountName:'Synthetic',platformKey:'weibo',companyId:'c',connectionMode:'BrowserAutomation',enabled:true,expectedRemoteIdentity:'remote',loginGeneration:1};
it('does not reuse a request from an old generation or let its late failure replace newer authentication',async()=>{
  let release!:(value:'expired')=>void;
  const first=new Promise<'expired'>(done=>{release=done;});
  const login=vi.fn().mockImplementationOnce(()=>first).mockResolvedValue('logged_in');
  const remote={manifest:{transport:'browser'},checkLogin:login,getAccountProfile:async()=>({accountId:'remote'})} as unknown as PlatformAdapter;
  let current=target;
  const coordinator=new AccountSessionRehydrationCoordinator({registry:{tryGetForConnection:()=>remote},browserSessions:{restore:async()=>({})} as unknown as BrowserSessionManager,resolveCompanyId:()=>current.companyId,resolveAuthoritativeTarget:()=>current});
  const old=coordinator.refresh(target);
  await vi.waitFor(()=>expect(login).toHaveBeenCalledTimes(1));
  current={...target,loginGeneration:2};
  const latest=coordinator.refresh(current);
  expect(latest).not.toBe(old);
  await expect(latest).resolves.toMatchObject({state:'AUTHENTICATED',loginGeneration:2});
  release('expired');await old;
  expect(coordinator.getSnapshot('a','weibo')).toMatchObject({state:'AUTHENTICATED',loginGeneration:2});
});
it('does not commit a failed restore after an in-flight disable',async()=>{
  let release!:(value:null)=>void;const pending=new Promise<null>(done=>{release=done;});let current=target;
  const remote={manifest:{transport:'browser'}} as unknown as PlatformAdapter;
  const coordinator=new AccountSessionRehydrationCoordinator({registry:{tryGetForConnection:()=>remote},browserSessions:{restore:()=>pending} as unknown as BrowserSessionManager,resolveCompanyId:()=>current.companyId,resolveAuthoritativeTarget:()=>current});
  const check=coordinator.refresh(target);await Promise.resolve();current={...target,enabled:false};release(null);
  await expect(check).resolves.toMatchObject({state:'DISABLED'});
});
