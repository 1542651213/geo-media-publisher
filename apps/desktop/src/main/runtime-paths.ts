import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

export interface RuntimePaths { userData: string; dataDirectory: string; database: string; credentials: string; browserProfiles: string; localState: string }

/** Resolve and reject production overlap before opening any store or starting recovery. */
export function resolveRuntimePaths(defaultUserData: string, isolated: string | undefined, production: boolean): RuntimePaths {
  let userData = resolve(defaultUserData);
  if (isolated !== undefined) {
    const candidate = resolve(isolated);
    if (!isAbsolute(isolated) || basename(candidate) !== "b01-isolated-user-data" || !existsSync(candidate)
      || !lstatSync(candidate).isDirectory() || lstatSync(candidate).isSymbolicLink()) throw new Error("ISOLATED_PATH_UNSAFE");
    const canonical = realpathSync(candidate).toLowerCase();
    const protectedPath = (existsSync(userData) ? realpathSync(userData) : userData).toLowerCase();
    if (canonical === protectedPath || canonical.startsWith(`${protectedPath}\\`) || canonical.startsWith(`${protectedPath}/`))
      throw new Error("ISOLATED_PATH_UNSAFE");
    userData = realpathSync(candidate);
  }
  const dataDirectory = join(userData, production ? "production-data" : "development-data");
  return { userData, dataDirectory, database: join(dataDirectory, "publisher.db"), credentials: join(dataDirectory, "credentials.enc"), browserProfiles: join(userData, "browser-profiles"), localState: join(userData, "Local State") };
}
