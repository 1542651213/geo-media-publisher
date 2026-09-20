import { describe,expect,it } from "vitest";
import { readXhsMax3Gate,parseXhsMax3Config } from "../apps/desktop/src/main/xhs-max3-config";
const root="D:/GEO/repairs/batch1-v0-f01-20260917";
const config={version:1,campaignId:"GEO_XHS_SOL_MAX3_20260918",runDirectory:`${root}/runtime/xhs-sol-max3-20260918`,executablePath:`${root}/xhs-max3-capture-package-20260918/win-unpacked/Geo Media Publisher.exe`,executableSha256:"a".repeat(64),appAsarPath:`${root}/xhs-max3-capture-package-20260918/win-unpacked/resources/app.asar`,appAsarSha256:"b".repeat(64),manifestPath:`${root}/evidence/xhs-sol-max3-20260918/OWNER_APPROVED_CONTENT.json`,manifestSha256:"2faaed8c1db1720f07cbf8099aab5d01e1f4106247ea528c8800af9ba37dd8a1",covers:[1,2,3].map(n=>({slot:`XHS-0${n}`,sha256:"c".repeat(64)})),accountId:"54b390ac-d81e-440a-baeb-d00f9f346cc3",creatorId:"960803317",expiresAtUtc:"2026-09-18T14:59:59Z"};
describe("scoped live config",()=>{
 it("requires both explicit gates and exact isolated paths",()=>{
  expect(readXhsMax3Gate({})).toBeNull();
  expect(()=>readXhsMax3Gate({GEO_XHS_MAX3:"OWNER_AUTHORIZED_MAX3_20260918"})).toThrow();
  expect(()=>readXhsMax3Gate({GEO_XHS_MAX3:"OWNER_AUTHORIZED_MAX3",GEO_XHS_MAX3_CONFIG:`${root}/runtime/xhs-sol-max3-20260918/config.json`})).toThrow();
  expect(()=>readXhsMax3Gate({GEO_XHS_MAX3:"OWNER_AUTHORIZED_MAX3_20260918",GEO_XHS_MAX3_CONFIG:`${root}/runtime/xhs-sol-max3-20260918/config.json`})).not.toThrow();
  expect(()=>parseXhsMax3Config({...config,runDirectory:"C:/Users/Administrator/AppData/Roaming/codex-media-publisher"})).toThrow();
  expect(()=>parseXhsMax3Config({...config,executablePath:"C:/GMP116ZhihuL5/Geo Media Publisher/Geo Media Publisher.exe"})).toThrow();
  expect(()=>parseXhsMax3Config({...config,accountId:"other"})).toThrow();
  expect(()=>parseXhsMax3Config({...config,campaignId:"GEO_XHS_SOL_MAX3_20260917"})).toThrow();
  expect(()=>parseXhsMax3Config({...config,expiresAtUtc:"2026-09-17T14:59:59Z"})).toThrow();
  expect(parseXhsMax3Config(config)).toMatchObject({campaignId:config.campaignId,accountId:config.accountId});
 });
});
