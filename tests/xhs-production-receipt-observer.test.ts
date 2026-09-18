import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Page, Request, Response } from "playwright-core";
import { XhsProductionReceiptObserver, projectSafeResponse, settleReceiptCapture } from "../packages/adapters/xiaohongshu/src/production-receipt-observer";

class FakePage extends EventEmitter { url(): string { return "https://creator.xiaohongshu.com/new/editor"; } isClosed(): boolean { return false; } }
const makeRequest = (url:string,method="POST") => ({ url:()=>url, method:()=>method, resourceType:()=>"fetch" }) as Request;
const makeResponse = (request:Request,body:string) => ({ request:()=>request, url:()=>request.url(), status:()=>200, text:async()=>body }) as Response;
const meta = { accountId:"a",creatorId:"c",jobId:"j",intentId:"i",snapshotId:"s",buildSha256:"b",contextId:"ctx",pageId:"page" };

describe("XHS production receipt observer",()=>{
  it("keeps an unreviewed same-page response Unknown even when it resembles a success receipt",async()=>{
    const page=new FakePage(); const records: unknown[]=[];
    const observer=new XhsProductionReceiptObserver(page as unknown as Page,meta,(event)=>{records.push(event)});
    observer.start(); observer.arm();
    const request=makeRequest("https://creator.xiaohongshu.com/api/note/publish");
    page.emit("request",request);
    page.emit("response",makeResponse(request,'{"success":true,"data":{"note_id":"note-accepted-1","note_url":"https://www.xiaohongshu.com/explore/note-accepted-1?xsec_token=hidden","status":"reviewing"}}'));
    await observer.flush();
    // No real XHS response schema has been reviewed for this pilot.  A generic
    // success/id/url shape must never create a false acceptance conclusion.
    expect(observer.result()).toMatchObject({status:"UNKNOWN_SCHEMA",accepted:false,published:false});
    expect(JSON.stringify(records)).not.toContain("hidden");
    observer.stop();
  });

  it("does not treat an identifier without an explicit success signal and canonical URL as acceptance",async()=>{
    const page=new FakePage(); const observer=new XhsProductionReceiptObserver(page as unknown as Page,meta,()=>{});
    observer.start(); observer.arm();
    const request=makeRequest("https://creator.xiaohongshu.com/api/note/publish");
    page.emit("request",request);
    page.emit("response",makeResponse(request,'{"code":0,"data":{"note_id":"ambiguous-id"}}'));
    await observer.flush();
    expect(observer.result()).toMatchObject({status:"UNKNOWN_SCHEMA",accepted:false,published:false});
    observer.stop();
  });

  it("starts before action, excludes old and unrelated requests, and persists a redacted same-page response",async()=>{
    const page=new FakePage(); const records: unknown[]=[];
    const observer=new XhsProductionReceiptObserver(page as unknown as Page,meta,(event)=>{records.push(event)});
    observer.start();
    page.emit("request",makeRequest("https://creator.xiaohongshu.com/api/old"));
    observer.arm();
    const unrelated=makeRequest("https://other.example.com/api/submit"); page.emit("request",unrelated);page.emit("response",makeResponse(unrelated,'{"id":"wrong"}'));
    const request=makeRequest("https://creator.xiaohongshu.com/api/submission?token=secret"); page.emit("request",request);
    page.emit("response",makeResponse(request,'{"data":{"note_id":"n-1","status":"pending","secret":"DO_NOT_KEEP","url":"https://www.xiaohongshu.com/explore/n-1?auth=HIDE"},"access_token":"HIDE"}'));
    const sibling=makeRequest("https://edith.xiaohongshu.com/api/receipt?token=secret");page.emit("request",sibling);page.emit("response",makeResponse(sibling,'{"data":{"note_id":"n-2","status":"pending"}}'));
    await observer.flush();
    expect(records.some(x=>JSON.stringify(x).includes("n-1"))).toBe(true);
    expect(records.some(x=>JSON.stringify(x).includes("n-2"))).toBe(true);
    const raw=JSON.stringify(records); expect(raw).not.toContain("secret");expect(raw).not.toContain("HIDE");expect(raw).not.toContain("other.example.com");expect(raw).not.toContain("api/old");
    expect(observer.result()).toMatchObject({status:"UNKNOWN_SCHEMA",accepted:false,published:false});
    observer.stop();
  });
  it("fails closed if readiness cannot be persisted",()=>{
    const page=new FakePage(); const observer=new XhsProductionReceiptObserver(page as unknown as Page,meta,()=>{throw new Error("disk full")});
    expect(()=>observer.start()).toThrow("disk full");
    expect(()=>observer.arm()).toThrow();
  });
  it("safe projection does not persist tokens or arbitrary nested personal data",()=>{
    const output=projectSafeResponse('{"code":0,"data":{"note_id":"n1","status":"audit","private":{"phone":"123"},"url":"https://xhs.com/a?token=abc"},"cookie":"xyz"}');
    expect(output).toMatchObject({code:0,data:{note_id:"n1",status:"audit",url:"https://xhs.com/a"}});
    expect(JSON.stringify(output)).not.toMatch(/phone|token|cookie|xyz|123/);
  });
  it("flushes a delayed response even when the click action throws after a possible send",async()=>{
    const page=new FakePage(); const records: unknown[]=[];
    const observer=new XhsProductionReceiptObserver(page as unknown as Page,meta,(event)=>{records.push(event)});
    const request=makeRequest("https://creator.xiaohongshu.com/api/submit");
    await expect(settleReceiptCapture(observer,async()=>{
      observer.arm();page.emit("request",request);
      setTimeout(()=>page.emit("response",makeResponse(request,'{"data":{"note_id":"n-delayed"}}')),5);
      throw new Error("click result uncertain");
    },()=>true,25)).rejects.toThrow("click result uncertain");
    expect(records.some(x=>JSON.stringify(x).includes("n-delayed"))).toBe(true);
    expect(page.listenerCount("request")).toBe(0);
  });
});

it("ordinary real adapter refuses any final action without an installed receipt sink",async()=>{
 const {XiaohongshuBrowserAdapter}=await import("../packages/adapters/xiaohongshu/src/browser");
 const page=new FakePage();let claims=0;
 const fake=Object.assign(Object.create(XiaohongshuBrowserAdapter.prototype) as InstanceType<typeof XiaohongshuBrowserAdapter>,{productionSubjectAndReadback:async()=>({verified:true}),productionPages:new Map([["j",{accountId:"a",snapshotId:"s",creatorId:"c",page,submitted:false}]])});
 const ctx={accountId:"a",accountName:"a",platformKey:"xiaohongshu",settings:{ordinaryProduction:true,publishJobId:"j",expectedExternalCreatorId:"c"}};
 const article={articleId:"article",contentSnapshotId:"s",title:"t",body:"b",summary:"",tags:[]};
 const attempt={jobId:"j",submissionIntentId:"i",attempt:1,productionPublicationGuard:{accountId:"a",contentSnapshotId:"s",claim:()=>{claims++;}}};
 await expect((XiaohongshuBrowserAdapter.prototype as unknown as {performProductionFinalSubmit:(ctx:unknown,article:unknown,attempt:unknown)=>Promise<unknown>}).performProductionFinalSubmit.call(fake,ctx,article,attempt)).rejects.toThrow("XHS_RECEIPT_CAPTURE_NOT_CONFIGURED");
 expect(claims).toBe(0);
});
