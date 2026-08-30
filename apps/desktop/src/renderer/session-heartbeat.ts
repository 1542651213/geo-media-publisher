import type { BrowserSessionHeartbeatInput, BrowserSessionHeartbeatPhase } from "../shared/api";

export type HeartbeatPhase = BrowserSessionHeartbeatPhase;

export interface HeartbeatSchedulerHandle {
  cancelled: boolean;
  timerId?: ReturnType<typeof globalThis.setTimeout>;
}

export interface HeartbeatScheduler {
  setTimeout(callback: () => void, delayMs: number): HeartbeatSchedulerHandle;
  clearTimeout(handle: HeartbeatSchedulerHandle): void;
}

export interface SessionHeartbeatApi {
  sessionHeartbeat(accountId: string, platformKey: string, input: BrowserSessionHeartbeatInput): Promise<unknown>;
}

const LOGIN_SURVIVAL_DELAY_MS = 10_000;

const browserHeartbeatScheduler: HeartbeatScheduler = {
  setTimeout: (callback, delayMs) => {
    const handle: HeartbeatSchedulerHandle = { cancelled: false };
    handle.timerId = globalThis.setTimeout(() => {
      if (!handle.cancelled) callback();
    }, delayMs);
    return handle;
  },
  clearTimeout: (handle) => {
    handle.cancelled = true;
    if (handle.timerId !== undefined) globalThis.clearTimeout(handle.timerId);
  },
};

const identityKey = (accountId: string, platformKey: string): string => `${platformKey}:${accountId}`;

export function createSessionHeartbeatController(api: SessionHeartbeatApi, scheduler: HeartbeatScheduler = browserHeartbeatScheduler) {
  const loginGenerations = new Map<string, number>();
  const survivalTimers = new Map<string, HeartbeatSchedulerHandle>();
  let heartbeatSequence = 0;

  const nextSequence = (): string => `heartbeat-${Date.now()}-${heartbeatSequence += 1}`;
  const safeHeartbeat = async (accountId: string, platformKey: string, phase: HeartbeatPhase, loginGeneration: number): Promise<void> => {
    const input: BrowserSessionHeartbeatInput = { phase, heartbeatSequence: nextSequence(), loginGeneration };
    try {
      await api.sessionHeartbeat(accountId, platformKey, input);
    } catch {
      // Diagnostics must never change the result or retry the business operation.
    }
  };

  const startPostLogin = (accountId: string, platformKey: string): number => {
    const key = identityKey(accountId, platformKey);
    const previousTimer = survivalTimers.get(key);
    if (previousTimer) scheduler.clearTimeout(previousTimer);
    const generation = (loginGenerations.get(key) ?? 0) + 1;
    loginGenerations.set(key, generation);
    void safeHeartbeat(accountId, platformKey, "POST_LOGIN_IMMEDIATE", generation);
    const timer = scheduler.setTimeout(() => {
      if (loginGenerations.get(key) !== generation) return;
      survivalTimers.delete(key);
      void safeHeartbeat(accountId, platformKey, "POST_LOGIN_SURVIVAL", generation);
    }, LOGIN_SURVIVAL_DELAY_MS);
    survivalTimers.set(key, timer);
    return generation;
  };

  const runCheckLogin = async <T>(accountId: string, platformKey: string, checkLogin: () => Promise<T>): Promise<T> => {
    const generation = loginGenerations.get(identityKey(accountId, platformKey)) ?? 0;
    await safeHeartbeat(accountId, platformKey, "PRE_CHECK_LOGIN", generation);
    try {
      return await checkLogin();
    } finally {
      await safeHeartbeat(accountId, platformKey, "POST_CHECK_LOGIN", generation);
    }
  };

  const runPreSubmitGate = async <T>(accountId: string, platformKey: string, gate: () => Promise<T>): Promise<T> => {
    const generation = loginGenerations.get(identityKey(accountId, platformKey)) ?? 0;
    await safeHeartbeat(accountId, platformKey, "PRE_SUBMIT_GATE_PRECHECK", generation);
    try {
      return await gate();
    } finally {
      await safeHeartbeat(accountId, platformKey, "POST_SUBMIT_GATE", generation);
    }
  };

  return { startPostLogin, runCheckLogin, runPreSubmitGate };
}

const rendererSessionHeartbeatController = createSessionHeartbeatController({
  sessionHeartbeat: (accountId, platformKey, input) => window.publisherAPI.accounts.sessionHeartbeat(accountId, platformKey, input),
});

export const beginPostLoginHeartbeat = (accountId: string, platformKey: string): number => rendererSessionHeartbeatController.startPostLogin(accountId, platformKey);
export const runCheckLoginWithHeartbeats = <T>(accountId: string, platformKey: string, checkLogin: () => Promise<T>): Promise<T> => rendererSessionHeartbeatController.runCheckLogin(accountId, platformKey, checkLogin);
export const runPreSubmitGateWithHeartbeats = <T>(accountId: string, platformKey: string, gate: () => Promise<T>): Promise<T> => rendererSessionHeartbeatController.runPreSubmitGate(accountId, platformKey, gate);
