import { expect,it } from "vitest";
import { unknownPublishResult,requiresReadOnlyPublishReconciliation } from "../apps/desktop/src/renderer/v11-ui-model";
it("offers reconciliation for unknown operations and keeps an unsubmitted job on its confirmation path",()=>{
  for(const platformKey of ["douyin","toutiao","website","weibo"]){
    for(const status of ["Unknown","NeedsReconciliation"] as const){expect(unknownPublishResult(status)).toBe(true);expect(requiresReadOnlyPublishReconciliation({platformKey,status})).toBe(true);}
    expect(requiresReadOnlyPublishReconciliation({platformKey,status:"AwaitingConfirmation"})).toBe(false);
    expect(unknownPublishResult("Published")).toBe(false);
  }
  expect(requiresReadOnlyPublishReconciliation({platformKey:"douyin",status:"Submitted"})).toBe(true);
  expect(requiresReadOnlyPublishReconciliation({platformKey:"toutiao",status:"Publishing"})).toBe(true);
});
