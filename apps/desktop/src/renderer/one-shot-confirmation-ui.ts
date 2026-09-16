export class OneShotConfirmationUiGuard {
  private inFlight = false;

  tryAcquire(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  release(): void { this.inFlight = false; }
}

export function oneShotConfirmationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("尚未进入发布流程") ? message : "一次性发布授权创建失败，尚未进入发布流程。";
}
