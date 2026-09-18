export type PreparedPublishFinalMode = "PREPARE_ONLY" | "CONFIRM_BEFORE_PUBLISH" | "AUTO_PUBLISH";

export function preparedPublishMessage(baseMessage: string, finalPublishMode: PreparedPublishFinalMode, response: Record<string, unknown>): string {
  if (finalPublishMode !== "AUTO_PUBLISH") return baseMessage;
  const finalSubmitControl = response.finalSubmitControl;
  const verified = typeof finalSubmitControl === "object" && finalSubmitControl !== null
    && (finalSubmitControl as { verified?: unknown }).verified === true;
  return verified ? baseMessage : `${baseMessage}；该浏览器平台尚无已验证的最终提交能力，已降级为发布前确认。`;
}
