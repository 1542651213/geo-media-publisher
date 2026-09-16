export const CONTENT_GATE_LIMITS = {
  titleMinLength: 1,
  titleMaxLength: 100,
  bodyMinLength: 1,
  bodyMaxLength: 10_000,
  imageMinCount: 0,
  imageMaxCount: 18
} as const;

export interface ContentQualityGateInput {
  title: string;
  body: string;
  imageCount: number;
}

export interface ContentQualityGateCheck {
  passed: boolean;
  actual: number;
  minimum: number;
  maximum: number;
}

export interface ContentQualityGateResult {
  passed: boolean;
  checks: {
    titleLength: ContentQualityGateCheck;
    bodyLength: ContentQualityGateCheck;
    imageCount: ContentQualityGateCheck;
  };
  failureCodes: string[];
}

const withinRange = (actual: number, minimum: number, maximum: number): boolean => actual >= minimum && actual <= maximum;

export function evaluateContentQualityGate(input: ContentQualityGateInput): ContentQualityGateResult {
  const titleLength = [...input.title].length;
  const bodyLength = [...input.body].length;
  const titlePassed = withinRange(titleLength, CONTENT_GATE_LIMITS.titleMinLength, CONTENT_GATE_LIMITS.titleMaxLength);
  const bodyPassed = withinRange(bodyLength, CONTENT_GATE_LIMITS.bodyMinLength, CONTENT_GATE_LIMITS.bodyMaxLength);
  const imagePassed = Number.isInteger(input.imageCount) && withinRange(input.imageCount, CONTENT_GATE_LIMITS.imageMinCount, CONTENT_GATE_LIMITS.imageMaxCount);

  const checks = {
    titleLength: { passed: titlePassed, actual: titleLength, minimum: CONTENT_GATE_LIMITS.titleMinLength, maximum: CONTENT_GATE_LIMITS.titleMaxLength },
    bodyLength: { passed: bodyPassed, actual: bodyLength, minimum: CONTENT_GATE_LIMITS.bodyMinLength, maximum: CONTENT_GATE_LIMITS.bodyMaxLength },
    imageCount: { passed: imagePassed, actual: input.imageCount, minimum: CONTENT_GATE_LIMITS.imageMinCount, maximum: CONTENT_GATE_LIMITS.imageMaxCount }
  } satisfies ContentQualityGateResult["checks"];

  const failureCodes: string[] = [];
  if (!titlePassed) failureCodes.push("TITLE_LENGTH_INVALID");
  if (!bodyPassed) failureCodes.push("BODY_LENGTH_INVALID");
  if (!imagePassed) failureCodes.push("IMAGE_COUNT_INVALID");

  return { passed: failureCodes.length === 0, checks, failureCodes };
}
