import { describe, expect, it } from "vitest";
import { isToutiaoReadyForFinalSubmit, type ToutiaoGateChecks } from "../scripts/toutiao-gate-only";

const passingGates: ToutiaoGateChecks = {
  accountIdentity: true,
  login: true,
  publishPermission: true,
  noSecurityVerification: true,
  articleEditor: true,
  title: true,
  body: true,
  strictReadback: true,
  cover: true,
  requiredFields: true,
  finalSubmitControl: true
};

describe("Toutiao gate-only preflight", () => {
  it("is ready only when every pre-submit gate is true", () => {
    expect(isToutiaoReadyForFinalSubmit(passingGates)).toBe(true);
    expect(isToutiaoReadyForFinalSubmit({ ...passingGates, publishPermission: false })).toBe(false);
    expect(isToutiaoReadyForFinalSubmit({ ...passingGates, finalSubmitControl: false })).toBe(false);
  });
});
