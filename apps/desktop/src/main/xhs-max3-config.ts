import { win32 } from "node:path";
import { z } from "zod";
const projectRoot=win32.resolve("D:/GEO/repairs/batch1-v0-f01-20260917");
const runRoot=win32.resolve(projectRoot,"runtime/xhs-sol-max3-20260918");
const approvedManifest=win32.resolve(projectRoot,"evidence/xhs-sol-max3-20260918/OWNER_APPROVED_CONTENT.json");
const packageRoot=win32.resolve(projectRoot,"xhs-max3-capture-package-20260918/win-unpacked");
const same=(a:string,b:string):boolean=>win32.resolve(a).toLowerCase()===win32.resolve(b).toLowerCase();
const inside=(parent:string,child:string):boolean=>win32.resolve(child).toLowerCase().startsWith(win32.resolve(parent).toLowerCase()+"\\");
const sha=z.string().regex(/^[0-9a-fA-F]{64}$/u);
const schema=z.object({version:z.literal(1),campaignId:z.literal("GEO_XHS_SOL_MAX3_20260918"),runDirectory:z.string(),executablePath:z.string(),executableSha256:sha,appAsarPath:z.string(),appAsarSha256:sha,manifestPath:z.string(),manifestSha256:sha,covers:z.array(z.object({slot:z.enum(["XHS-01","XHS-02","XHS-03"]),sha256:sha}).strict()).length(3),accountId:z.string().uuid(),creatorId:z.string().regex(/^[0-9]{4,20}$/u),expiresAtUtc:z.literal("2026-09-18T14:59:59Z")}).strict();
export type XhsMax3Config=z.infer<typeof schema>;
export function readXhsMax3Gate(env:Record<string,string|undefined>):string|null{
 const flag=env.GEO_XHS_MAX3;const path=env.GEO_XHS_MAX3_CONFIG;
 if(flag===undefined&&path===undefined)return null;
 if(flag!=="OWNER_AUTHORIZED_MAX3_20260918"||!path||!inside(runRoot,path)||win32.extname(path).toLowerCase()!==".json")throw new Error("XHS_MAX3_EXPLICIT_DUAL_GATE_REQUIRED");
 return win32.resolve(path);
}
export function parseXhsMax3Config(value:unknown):XhsMax3Config{
 const config=schema.parse(value);
 if(config.covers.some((cover,index)=>cover.slot!==`XHS-0${index+1}`)||!same(config.runDirectory,runRoot)||!same(config.executablePath,win32.join(packageRoot,"Geo Media Publisher.exe"))||!same(config.appAsarPath,win32.join(packageRoot,"resources/app.asar"))||!same(config.manifestPath,approvedManifest)||config.manifestSha256.toLowerCase()!=="2faaed8c1db1720f07cbf8099aab5d01e1f4106247ea528c8800af9ba37dd8a1")throw new Error("XHS_MAX3_IDENTITY_OR_PATH_MISMATCH");
 return {...config,runDirectory:runRoot,executablePath:win32.resolve(config.executablePath),appAsarPath:win32.resolve(config.appAsarPath),manifestPath:approvedManifest,executableSha256:config.executableSha256.toLowerCase(),appAsarSha256:config.appAsarSha256.toLowerCase(),manifestSha256:config.manifestSha256.toLowerCase()};
}
