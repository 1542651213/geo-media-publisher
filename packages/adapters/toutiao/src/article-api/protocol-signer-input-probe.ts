/** Diagnostic-only code serialized into the authorized Creator page under the Shadow write guard. */
export async function probeAcrCrawlerInputContractInPage(): Promise<Readonly<{
  exists: boolean;
  signExists: boolean;
  signLength: number | null;
  signSourceSha256: string | null;
  probes: readonly Readonly<{
    inputShape: string;
    returnType: string;
    returnLength: number | null;
    returnKeys: readonly string[];
    outputSha256: string | null;
    exceptionType: string | null;
    exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER";
    argumentKeysAfter: readonly string[];
    domMutationCount: number;
    localStorageDiff: Readonly<{ available: boolean; addedCount: number; removedCount: number; changedCount: number; addedKeyHashes: readonly string[]; removedKeyHashes: readonly string[]; changedKeyHashes: readonly string[] }>;
    sessionStorageDiff: Readonly<{ available: boolean; addedCount: number; removedCount: number; changedCount: number; addedKeyHashes: readonly string[]; removedKeyHashes: readonly string[]; changedKeyHashes: readonly string[] }>;
  }>[];
}>> {
  const root = Object.getOwnPropertyDescriptor(window, "byted_acrawler");
  const sdk: unknown = root && "value" in root ? root.value : undefined;
  if (!sdk || (typeof sdk !== "object" && typeof sdk !== "function"))
    return { exists: false, signExists: false, signLength: null, signSourceSha256: null, probes: [] };
  const descriptor = Object.getOwnPropertyDescriptor(sdk, "sign");
  const sign: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof sign !== "function")
    return { exists: true, signExists: false, signLength: null, signSourceSha256: null, probes: [] };
  const digest = async (input: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const snapshot = (storage: Storage): Map<string, string> | null => {
    try {
      const entries = new Map<string, string>();
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) entries.set(key, storage.getItem(key) ?? "");
      }
      return entries;
    } catch { return null; }
  };
  const diff = async (before: Map<string, string> | null, after: Map<string, string> | null) => {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    if (before && after) {
      for (const [key, value] of after) {
        if (!before.has(key)) added.push(key);
        else if (before.get(key) !== value) changed.push(key);
      }
      for (const key of before.keys()) if (!after.has(key)) removed.push(key);
    }
    const hashes = async (keys: string[]) => Promise.all(keys.sort().slice(0, 20).map(digest));
    return { available: before !== null && after !== null, addedCount: added.length, removedCount: removed.length,
      changedCount: changed.length, addedKeyHashes: await hashes(added), removedKeyHashes: await hashes(removed), changedKeyHashes: await hashes(changed) };
  };
  const inputs: Array<{ inputShape: string; argument: Record<string, unknown> | null }> = [
    { inputShape: "NO_ARGUMENTS", argument: null },
    { inputShape: "EMPTY_OBJECT", argument: {} },
    { inputShape: "URL_TEST_1", argument: { url: "/test" } },
    { inputShape: "URL_TEST_2", argument: { url: "/test" } },
    { inputShape: "URL_TEST_A", argument: { url: "/test-a" } },
    { inputShape: "URL_TEST_B", argument: { url: "/test-b" } },
    { inputShape: "QUERY_EMPTY", argument: { url: "/test", query: {} } },
    { inputShape: "QUERY_A1", argument: { url: "/test", query: { a: "1" } } },
    { inputShape: "BODY_A", argument: { url: "/test", body: "a" } },
    { inputShape: "BODY_B", argument: { url: "/test", body: "b" } }
  ];
  const probes: Array<{
    inputShape: string; returnType: string; returnLength: number | null; returnKeys: string[]; outputSha256: string | null;
    exceptionType: string | null; exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER";
    argumentKeysAfter: string[]; domMutationCount: number;
    localStorageDiff: Awaited<ReturnType<typeof diff>>; sessionStorageDiff: Awaited<ReturnType<typeof diff>>;
  }> = [];
  for (const { inputShape, argument } of inputs) {
    const localBefore = snapshot(localStorage);
    const sessionBefore = snapshot(sessionStorage);
    let domMutationCount = 0;
    const observer = new MutationObserver((records) => { domMutationCount += records.length; });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    let output: unknown;
    let exceptionType: string | null = null;
    let exceptionCategory: "NONE" | "URL_ARGUMENT_REQUIRED" | "ARGUMENT_REQUIRED" | "OTHER" = "NONE";
    try {
      // The arguments contain no real endpoint, account data, content, credential, or publish field.
      output = Reflect.apply(sign, sdk, argument === null ? [] : [argument]);
    } catch (error) {
      const candidate = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : null;
      exceptionType = typeof candidate?.name === "string" && /^(?:TypeError|Error|RangeError|ReferenceError)$/u.test(candidate.name) ? candidate.name : "OTHER";
      const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
      exceptionCategory = /\burl\b/u.test(message) ? "URL_ARGUMENT_REQUIRED" : /argument|param|require/u.test(message) ? "ARGUMENT_REQUIRED" : "OTHER";
    }
    domMutationCount += observer.takeRecords().length;
    observer.disconnect();
    const localAfter = snapshot(localStorage);
    const sessionAfter = snapshot(sessionStorage);
    const returnType = Array.isArray(output) ? "array" : typeof output;
    const returnKeys = output !== null && typeof output === "object" ? Object.getOwnPropertyNames(output)
      .filter((key) => /^[a-zA-Z_$][\w$]{0,40}$/u.test(key)).slice(0, 30) : [];
    const returnLength = typeof output === "string" || Array.isArray(output) ? output.length : null;
    // The return value is kept in the page. Only a one-way digest crosses IPC.
    const outputSha256 = typeof output === "string" ? await digest(output) : null;
    probes.push({ inputShape, returnType, returnLength, returnKeys, outputSha256, exceptionType, exceptionCategory,
      argumentKeysAfter: argument === null ? [] : Object.getOwnPropertyNames(argument).filter((key) => /^[a-zA-Z_$][\w$]{0,40}$/u.test(key)).slice(0, 30),
      domMutationCount, localStorageDiff: await diff(localBefore, localAfter), sessionStorageDiff: await diff(sessionBefore, sessionAfter) });
  }
  return { exists: true, signExists: true, signLength: sign.length,
    signSourceSha256: await digest(Function.prototype.toString.call(sign)), probes };
}
