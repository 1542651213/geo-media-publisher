import type { Logger } from "@publisher/logger";

export interface AppStartupLogContext {
  pid: number;
  packaged: boolean;
  userDataPath: string;
  productionDataPath: string;
  appLogPath: string;
}

export function recordAppStartup(logger: Logger, context: AppStartupLogContext): void {
  logger.info("APP", "APP_STARTUP", "应用启动并完成本地日志初始化", { ...context });
}

export function recordRuntimeHeartbeat(logger: Logger, action: string): void {
  logger.info("APP", "RUNTIME_HEARTBEAT", "只读运行时状态读取", { action });
}
