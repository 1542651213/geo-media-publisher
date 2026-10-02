import { AsyncLocalStorage } from 'node:async_hooks';
import type { CredentialStore } from '@publisher/security';
/** Protect Adapter token writes in the original auth I/O chain; ordinary explicit edits remain usable. */
export class CredentialWriteScope<T extends CredentialStore> {
  private readonly current=new AsyncLocalStorage<()=>boolean>();
  readonly credentials:T;
  constructor(store:T){this.credentials=new Proxy(store,{get:(target,key)=>{
    const member=Reflect.get(target,key) as unknown;
    if(typeof member!=='function')return member;
    if(key==='set'||key==='setMany'||key==='delete')return (...args:unknown[])=>{const guard=this.current.getStore();if(guard&&!guard())throw Object.assign(new Error('AUTH_REQUEST_SUPERSEDED'),{code:'AUTH_REQUEST_SUPERSEDED'});return Reflect.apply(member,target,args);};
    return member.bind(target);
  }});}
  run<R>(isCurrent:()=>boolean,operation:()=>Promise<R>):Promise<R>{return this.current.run(isCurrent,operation);}
}
