import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { readXiaohongshuUploadInputImmediately } from "../packages/adapters/xiaohongshu/src/upload-delivery-diagnostic";

it.each(["matching", "replaced", "missing"] as const)("ARM upload verifies actual browser File bytes: %s", async (mode) => {
  const bytes=Buffer.from("bound image A");
  const hash=createHash("sha256").update(bytes).digest("hex");
  let files: File[]=[];
  let setCalls=0;
  const element={tagName:"INPUT",type:"file",accept:"image/*",multiple:true,disabled:false,isConnected:true,className:"",get files(){return files;}};
  const handle={
    evaluate: async (fn:(node:typeof element,flag?:boolean)=>unknown,flag?:boolean)=>fn(element,flag),
    setInputFiles: async (input:Array<{name:string;mimeType:string;buffer:Buffer}>)=>{
      setCalls++;
      files=mode==="missing"?[]:input.map((i)=>new File([Uint8Array.from(mode==="replaced"?Buffer.from("bound image B"):i.buffer)],i.name,{type:i.mimeType}));
    }
  };
  const locator={elementHandle:async()=>handle} as unknown as Parameters<typeof readXiaohongshuUploadInputImmediately>[0];
  const result=await readXiaohongshuUploadInputImmediately(locator,["unread-original-path"],undefined,undefined,[{assetId:"asset",name:"image.png",mimeType:"image/png",sha256:hash,buffer:bytes}]);
  expect(setCalls).toBe(1);
  expect(result.status).toBe(mode==="matching"?"PASS":"FAIL");
  if(mode==="matching")expect(result.uploadedByteSha256).toEqual([hash]);
  if(mode==="replaced")expect(result.uploadedByteSha256).not.toEqual([hash]);
});
