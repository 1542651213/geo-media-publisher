import type { PublishArticleInput, ValidationResult } from "@publisher/domain";
import type { ToutiaoAccountPreflightResult } from "../../../../packages/adapters/toutiao/src/browser";

export async function assertToutiaoProductReadiness(port: {
  expectedCreatorId: string | null | undefined; input: PublishArticleInput;
  imageAvailable: boolean; imageBrandMatch: boolean;
  validate(input: PublishArticleInput): Promise<ValidationResult>;
  inspect(): Promise<ToutiaoAccountPreflightResult>;
}): Promise<void> {
  if (!port.expectedCreatorId || !/^[1-9]\d*$/u.test(port.expectedCreatorId)) throw new Error("TOUTIAO_ACCOUNT_IDENTITY_UNVERIFIED");
  if (!port.imageAvailable || !port.imageBrandMatch) throw new Error("TOUTIAO_OWNED_IMAGE_REQUIRED");
  if (/<\/?[a-z][^>]*>/iu.test(port.input.body)) throw new Error("TOUTIAO_BROWSER_PLAIN_TEXT_BODY_REQUIRED");
  const validation = await port.validate(port.input);
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  const readiness = await port.inspect();
  if (!readiness.allowed || !readiness.creatorCenterAccessible || !readiness.articlePublishPermission
    || readiness.identity.externalAccountId !== port.expectedCreatorId) throw new Error("TOUTIAO_ACCOUNT_IDENTITY_UNVERIFIED");
}
