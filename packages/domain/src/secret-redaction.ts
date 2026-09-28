const SECRET_KEY = /^(?:authorization|bearer|api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set[-_]?cookie|cookieMaterial|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|password|storagestate|token|tokenMaterial|csrf(?:[_-]?token)?|x-secsdk-csrf-token|tt-anti-token|anti[_-]?token|ms[_-]?token|a[_-]?bogus|signature|credentialBundle|sessionIdentity)$/iu;
const SECRET_LABEL = "(?:authorization|bearer|api[_-]?key|apikey|appsecret|client[_-]?secret|secret|cookie|set[-_]?cookie|cookieMaterial|access[_-]?token|refresh[_-]?token|page[_-]?access[_-]?token|oauth[_-]?access[_-]?token|password|storagestate|token|csrf(?:[_-]?token)?|x-secsdk-csrf-token|tt-anti-token|anti[_-]?token|ms[_-]?token|a[_-]?bogus|signature)";

export function isSecretEvidenceKey(key: string): boolean { return SECRET_KEY.test(key); }

export function redactSecretText(value: string): string {
  const quoted = new RegExp(`("${SECRET_LABEL}"\\s*:\\s*")[^"\\r\\n]*(")`, "giu");
  const labelled = new RegExp(`\\b(${SECRET_LABEL}\\s*[:=]\\s*)(?!\\[REDACTED\\])[^\\s,;}&]+`, "giu");
  const query = new RegExp(`([?&]${SECRET_LABEL}=)[^&#\\s]+`, "giu");
  return value.replace(quoted, "$1[REDACTED]$2").replace(/\bAuthorization\s*[:=]\s*Bearer\s+[^\s,;]+/giu, "Authorization=[REDACTED]")
    .replace(/\b((?:Set-)?Cookie\s*[:=]\s*)[^\r\n]+/giu, "$1[REDACTED]").replace(query, "$1[REDACTED]")
    .replace(labelled, "$1[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}

export function redactSecretValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecretText(value);
  if (Array.isArray(value)) return value.map(redactSecretValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => isSecretEvidenceKey(key) ? [key, "[REDACTED]"] : [key, redactSecretValue(item)]));
  return value;
}
