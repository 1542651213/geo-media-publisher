export type ApplicationShutdownState = "RUNNING" | "SHUTTING_DOWN" | "CLEANUP_COMPLETE" | "EXITING";

export type ApplicationShutdownEvent =
  | "WINDOW_CLOSE_REQUESTED"
  | "WINDOW_DESTROYED"
  | "APP_QUIT_REQUESTED"
  | "BEFORE_QUIT_ENTERED"
  | "SCHEDULERS_STOP_STARTED"
  | "SCHEDULERS_STOP_COMPLETED"
  | "BROWSER_SESSIONS_CLOSE_STARTED"
  | "BROWSER_SESSIONS_CLOSE_COMPLETED"
  | "DB_CLOSE_STARTED"
  | "DB_CLOSE_COMPLETED"
  | "APP_EXIT_CALLED"
  | "APP_MAIN_EXIT";

export interface ApplicationShutdownOptions {
  stopSchedulers: () => void | Promise<void>;
  closeBrowserSessions: () => void | Promise<void>;
  closeDatabase?: () => void | Promise<void>;
  timeoutMs?: number;
  onEvent?: (event: ApplicationShutdownEvent) => void;
  onError?: (stage: ApplicationShutdownEvent, error: unknown) => void;
}

export interface QuitEventLike {
  preventDefault(): void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Owns the one allowed application shutdown sequence. Electron can emit
 * before-quit more than once (including when app.quit() is called after the
 * async cleanup), so this coordinator deliberately makes every transition
 * idempotent and never calls process.exit().
 */
export class ApplicationShutdownCoordinator {
  private state: ApplicationShutdownState = "RUNNING";
  private cleanupPromise: Promise<void> | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApplicationShutdownOptions) {
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 9_000);
  }

  getState(): ApplicationShutdownState { return this.state; }

  record(event: ApplicationShutdownEvent): void { this.options.onEvent?.(event); }

  handleBeforeQuit(event: QuitEventLike, requestQuit: () => void): void {
    this.record("APP_QUIT_REQUESTED");
    this.record("BEFORE_QUIT_ENTERED");
    if (this.state === "EXITING") return;
    if (this.state === "CLEANUP_COMPLETE") {
      this.state = "EXITING";
      this.record("APP_EXIT_CALLED");
      return;
    }
    event.preventDefault();
    if (this.state === "SHUTTING_DOWN") return;
    this.state = "SHUTTING_DOWN";
    this.cleanupPromise = this.cleanup().finally(() => {
      this.state = "CLEANUP_COMPLETE";
      requestQuit();
    });
  }

  async waitForCleanup(): Promise<void> {
    await this.cleanupPromise;
  }

  markMainExit(): void {
    this.record("APP_MAIN_EXIT");
    this.state = "EXITING";
  }

  private async cleanup(): Promise<void> {
    await this.runStage("SCHEDULERS_STOP_STARTED", "SCHEDULERS_STOP_COMPLETED", this.options.stopSchedulers);
    await this.runStage("BROWSER_SESSIONS_CLOSE_STARTED", "BROWSER_SESSIONS_CLOSE_COMPLETED", this.options.closeBrowserSessions);
    if (this.options.closeDatabase) await this.runStage("DB_CLOSE_STARTED", "DB_CLOSE_COMPLETED", this.options.closeDatabase);
  }

  private async runStage(start: ApplicationShutdownEvent, complete: ApplicationShutdownEvent, action: () => void | Promise<void>): Promise<void> {
    this.record(start);
    try {
      await this.withTimeout(Promise.resolve().then(action), start);
    } catch (error) {
      this.options.onError?.(start, error);
    } finally {
      this.record(complete);
    }
  }

  private async withTimeout(operation: Promise<void>, stage: ApplicationShutdownEvent): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${stage} timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    try { await Promise.race([operation, timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export function shutdownErrorMessage(error: unknown): string { return asError(error).message; }
