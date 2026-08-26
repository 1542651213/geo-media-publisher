import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Platform } from "@publisher/domain";

/**
 * Account lifecycle capability is intentionally overlaid on the repository
 * platform view. Publish transport and content routing remain unchanged.
 */
export function addAccountConnectionMode(platform: Platform, registry: AdapterRegistry): Platform {
  const accountConnectionMode = registry.getAccountConnectionMode(platform.platformKey);
  return accountConnectionMode ? { ...platform, accountConnectionMode } : platform;
}

export function addAccountConnectionModes(platforms: Platform[], registry: AdapterRegistry): Platform[] {
  return platforms.map((platform) => addAccountConnectionMode(platform, registry));
}
