/** Diagnostics only. This function is serialized into the authorized, guarded Creator page. */
export async function probeAcrCrawlerSignInPage(): Promise<Readonly<{
  exists: boolean;
  signExists: boolean;
  initExists: boolean;
  objectKeys: readonly string[];
  signName: string | null;
  signLength: number | null;
  signSourceLength: number | null;
  signSourceSha256: string | null;
  probes: readonly Readonly<{
    inputShape: "NO_ARGUMENTS" | "EMPTY_OBJECT";
    returnType: string;
    returnLength: number | null;
    returnKeys: readonly string[];
    argumentKeysAfter: readonly string[];
    exceptionType: string | null;
    exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER";
    domMutationCount: number;
    storageChanged: boolean;
    windowKeysChanged: boolean;
  }>[];
}>> {
  const root = Object.getOwnPropertyDescriptor(window, "byted_acrawler");
  const value: unknown = root && "value" in root ? root.value : undefined;
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return { exists: false, signExists: false, initExists: false, objectKeys: [], signName: null,
      signLength: null, signSourceLength: null, signSourceSha256: null, probes: [] };
  }
  const sdk = value as Record<string, unknown>;
  const signDescriptor = Object.getOwnPropertyDescriptor(sdk, "sign");
  const initDescriptor = Object.getOwnPropertyDescriptor(sdk, "init");
  const sign: unknown = signDescriptor && "value" in signDescriptor ? signDescriptor.value : undefined;
  const objectKeys = Object.getOwnPropertyNames(sdk).filter((key) => /^[a-zA-Z_$][\w$]{0,40}$/u.test(key)).slice(0, 40);
  if (typeof sign !== "function") {
    return { exists: true, signExists: false, initExists: Boolean(initDescriptor && "value" in initDescriptor && typeof initDescriptor.value === "function"),
      objectKeys, signName: null, signLength: null, signSourceLength: null, signSourceSha256: null, probes: [] };
  }
  const digest = async (input: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageState = async (): Promise<string> => {
    try {
      const parts: string[] = [];
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) parts.push(`${key.length}:${key}:${storage.getItem(key) ?? ""}`);
        }
        parts.push("|storage-boundary|");
      }
      return digest(parts.join("\u0000"));
    } catch { return "STORAGE_UNAVAILABLE"; }
  };
  const source = Function.prototype.toString.call(sign);
  const signSourceLength = source.length;
  const signSourceSha256 = await digest(source);
  const safeKeys = (input: object): string[] => Object.getOwnPropertyNames(input)
    .filter((key) => /^[a-zA-Z_$][\w$]{0,40}$/u.test(key)).slice(0, 30);
  const probes: Array<{
    inputShape: "NO_ARGUMENTS" | "EMPTY_OBJECT"; returnType: string; returnLength: number | null;
    returnKeys: string[]; argumentKeysAfter: string[]; exceptionType: string | null; exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER";
    domMutationCount: number; storageChanged: boolean; windowKeysChanged: boolean;
  }> = [];
  for (const inputShape of ["NO_ARGUMENTS", "EMPTY_OBJECT"] as const) {
    const beforeStorage = await storageState();
    const beforeWindowKeys = Object.getOwnPropertyNames(window).join("\u0000");
    let domMutationCount = 0;
    const observer = new MutationObserver((records) => { domMutationCount += records.length; });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    let returnType = "undefined";
    let returnLength: number | null = null;
    let returnKeys: string[] = [];
    const argument = inputShape === "EMPTY_OBJECT" ? {} : null;
    let exceptionType: string | null = null;
    let exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER" = "NONE";
    try {
      // No endpoint, account data, content, Cookie, token, or publish payload is supplied.
      const result: unknown = Reflect.apply(sign, sdk, argument === null ? [] : [argument]);
      returnType = typeof result;
      if (typeof result === "string") returnLength = result.length;
      else if (result !== null && typeof result === "object") {
        returnType = Array.isArray(result) ? "array" : "object";
        returnKeys = safeKeys(result);
        if (Array.isArray(result)) returnLength = result.length;
      }
    } catch (error) {
      const candidate = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : null;
      exceptionType = typeof candidate?.name === "string" && /^(?:TypeError|Error|RangeError|ReferenceError)$/u.test(candidate.name) ? candidate.name : "OTHER";
      const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
      exceptionCategory = /\burl\b/u.test(message) ? "URL_ARGUMENT_REQUIRED" : /argument|param|require/u.test(message) ? "ARGUMENT_REQUIRED" : "OTHER";
    } finally {
      domMutationCount += observer.takeRecords().length;
      observer.disconnect();
    }
    probes.push({ inputShape, returnType, returnLength, returnKeys, argumentKeysAfter: argument === null ? [] : safeKeys(argument), exceptionType, exceptionCategory,
      domMutationCount, storageChanged: beforeStorage !== await storageState(),
      windowKeysChanged: beforeWindowKeys !== Object.getOwnPropertyNames(window).join("\u0000") });
  }
  return { exists: true, signExists: true, initExists: Boolean(initDescriptor && "value" in initDescriptor && typeof initDescriptor.value === "function"),
    objectKeys, signName: /^[a-zA-Z_$][\w$]{0,40}$/u.test(sign.name) ? sign.name : null,
    signLength: sign.length, signSourceLength, signSourceSha256, probes };
}
