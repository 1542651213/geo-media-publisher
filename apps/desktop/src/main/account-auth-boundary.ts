import type { AppRepository } from '@publisher/db';
const epochs=new WeakMap<AppRepository,Map<string,number>>();
function revisions(repository:AppRepository):Map<string,number>{let map=epochs.get(repository);if(!map){map=new Map();epochs.set(repository,map);}return map;}
export function invalidateAccountAuthBoundary(repository:AppRepository,accountId:string,platformKey:string):void{const map=revisions(repository),key=`${platformKey}:${accountId}`;map.set(key,(map.get(key)??0)+1);}
/** Captures Main routing and explicit auth epoch, including reconfirmation without a binding version increment. */
export function captureAccountAuthBoundary(repository:AppRepository,accountId:string,platformKey:string):()=>void{
  const snapshot=():string=>{const account=repository.getAccountById(accountId,platformKey),binding=repository.db.prepare('SELECT company_id,version FROM operations_account_company_bindings WHERE account_id=?').get(accountId);return JSON.stringify({epoch:revisions(repository).get(`${platformKey}:${accountId}`)??0,binding,account:account?[account.id,account.platformKey,account.enabled,account.archivedAt??null,account.connectionMode??null,account.externalAccountId??null,account.browserSessionId??null]:null});};
  const before=snapshot();return()=>{if(snapshot()!==before)throw Object.assign(new Error('ACCOUNT_AUTH_BINDING_CHANGED'),{code:'ACCOUNT_AUTH_BINDING_CHANGED'});};
}
