function tokens(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const wordTokens = normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean);
  const cjkTokens: string[] = [];
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) cjkTokens.push(sequence.slice(index, index + 2));
  }
  return new Set([...wordTokens, ...cjkTokens]);
}

export function textSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

export function isTooSimilar(left: string, right: string, threshold = 0.72): boolean {
  return textSimilarity(left, right) >= threshold;
}
