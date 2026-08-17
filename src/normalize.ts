export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function literalPattern(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map(escapeRegExp)
    .join("\\s+");
}

/**
 * Exact phrase search with identifier-safe boundaries. A key such as GOV-1
 * cannot match GOV-10 or GOV-1A.
 */
export function findBoundedLiteral(
  haystack: string,
  needle: string,
): string | undefined {
  if (needle.trim().length === 0) {
    return undefined;
  }

  const pattern = literalPattern(needle);
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`,
    "iu",
  );
  return expression.exec(haystack)?.[0];
}

/**
 * Human-language phrase search. Latin/identifier-only phrases keep token
 * boundaries; CJK-containing phrases may be adjacent to surrounding CJK text.
 */
export function findLiteralPhrase(
  haystack: string,
  needle: string,
): string | undefined {
  if (needle.trim().length === 0) {
    return undefined;
  }
  const pattern = literalPattern(needle);
  const containsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    needle,
  );
  const source = containsCjk
    ? pattern
    : `(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`;
  return new RegExp(source, "iu").exec(haystack)?.[0];
}

export function findNormalizedPhrase(
  haystack: string,
  needle: string,
): string | undefined {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (normalizedNeedle.length === 0) {
    return undefined;
  }

  const match = findLiteralPhrase(normalizedHaystack, normalizedNeedle);
  return match ? normalizedNeedle : undefined;
}
