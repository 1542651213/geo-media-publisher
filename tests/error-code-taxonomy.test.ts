import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@publisher/domain";

describe("XHS publish failure taxonomy", () => {
  it("exposes distinct lifecycle, gate, authorization, and reconciliation codes", () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining([
      "SESSION_NOT_FOUND",
      "AUTH_NOT_VERIFIED",
      "ACCOUNT_IDENTITY_UNVERIFIED",
      "ACCOUNT_IDENTITY_MISMATCH",
      "CANONICAL_PAGE_NOT_FOUND",
      "CANONICAL_PAGE_CLOSED",
      "CREATOR_HOME_NOT_READY",
      "PUBLISH_NAVIGATION_FAILED",
      "PRE_UPLOAD_NOT_READY",
      "UPLOAD_CAPABILITY_NOT_FOUND",
      "POST_UPLOAD_NOT_READY",
      "INTERMEDIATE_ACTION_REQUIRED",
      "TITLE_EDITOR_NOT_FOUND",
      "TITLE_READBACK_FAILED",
      "BODY_EDITOR_NOT_FOUND",
      "BODY_READBACK_FAILED",
      "REQUIRED_SETTINGS_INCOMPLETE",
      "FINAL_SUBMIT_NOT_READY",
      "ONE_SHOT_AUTHORIZATION_MISSING",
      "ONE_SHOT_AUTHORIZATION_AMBIGUOUS",
      "ONE_SHOT_AUTHORIZATION_CONSUMED",
      "PUBLICATION_NEEDS_RECONCILIATION"
    ]));
  });
});
