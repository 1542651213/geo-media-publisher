import { expect,it } from 'vitest';
import { BrowserAutomationAdapter } from '../packages/adapters/browser/src/index';
import { type BrowserSessionManager,defaultCapabilities,type BrowserSession } from '@publisher/adapters-core';
import type { AccountContext } from '@publisher/domain';
it('keeps the new connection and its credential after the old browser close completes',async()=>{
  const session=():BrowserSession=>{const context={pages:()=>[page]},page={context:()=>context,isClosed:()=>false,goto:async()=>{},url:()=> 'https://fixture.invalid/'};return{context,page,browser:{},hasStoredSession:false,executionMode:'VISIBLE',storageMode:'EPHEMERAL_STORAGE_STATE',profilePath:null} as unknown as BrowserSession;};
  let closeCount=0,finish!:()=>void,enter!:()=>void,clears=0;const entered=new Promise<void>(resolve=>{enter=resolve;});
  const manager={open:async()=>session(),close:async()=>{if(++closeCount===1){enter();await new Promise<void>(resolve=>{finish=resolve;});}},clear:()=>{clears++;}} as unknown as BrowserSessionManager;
  const adapter=new BrowserAutomationAdapter({platformKey:'fixture',displayName:'合成平台',category:'fixture',officialWebsite:'https://fixture.invalid/',backendUrl:'https://fixture.invalid/',officialSources:[],capabilities:defaultCapabilities,version:'fixture',blockingReason:'fixture',researchStatus:'partial'},{sessionManager:manager});
  const ctx={accountId:'synthetic-account',settings:{userInitiatedAction:{userActionId:'fixture',kind:'CONNECT_ACCOUNT',createdAt:new Date().toISOString()}}} as unknown as AccountContext;
  await adapter.connectAccount(ctx);const oldLogout=adapter.logout(ctx);await entered;await adapter.connectAccount(ctx);finish();await oldLogout;
  expect(clears).toBe(0);expect(adapter.getBrowserConnectionDebugState(ctx).targetSessionFound).toBe(true);expect(adapter.getBrowserConnectionDebugState(ctx).targetSessionState).toBe('OPEN_PENDING');
});
