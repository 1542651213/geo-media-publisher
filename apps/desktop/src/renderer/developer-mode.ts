import { createContext } from "react";
export const DeveloperModeContext = createContext(false);
export const DEVELOPER_ROUTES = new Set(["studio", "batch", "ai-tasks", "quality-rules", "assets", "platforms", "self-test", "plans", "queue", "logs", "settings", "placeholder"]);
