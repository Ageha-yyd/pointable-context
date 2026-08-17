import { Buffer } from "node:buffer";
import type { FactValue, LookupOutcome } from "./contracts.js";

const MAX_OUTPUT_BYTES = 16_384;

function exposeInvisibleCharacters(value: unknown): string {
  let result = "";
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      result += " ";
    } else if (
      /[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(character) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      result += `⟦U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}⟧`;
    } else {
      result += character;
    }
  }
  return result;
}

function escapeEmphasisUnderscores(value: string): string {
  return value.replace(/_+/gu, (run, offset, input: string) => {
    const before = [...input.slice(0, offset)].at(-1) ?? "";
    const after = [...input.slice(offset + run.length)][0] ?? "";
    const isWord = (character: string): boolean => /[\p{L}\p{N}]/u.test(character);
    return isWord(before) && isWord(after)
      ? run
      : run.replace(/_/gu, "\\_");
  });
}

function truncateCharacters(value: string, maximumCharacters: number): string {
  let result = "";
  let count = 0;
  for (const character of value) {
    if (count >= maximumCharacters) return `${result}…`;
    result += character;
    count += 1;
  }
  return result;
}

function plain(value: unknown, maximumLength = 1_024): string {
  const sanitized = escapeEmphasisUnderscores(exposeInvisibleCharacters(value)
    .replace(/\s+/gu, " ")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*\[\]{}()!~|>])/gu, "\\$1")
    .replace(/\b(https?|ftp):\/\//giu, "$1\\://")
    .replace(/\bwww\./giu, "www\\.")
    .replace(/@/gu, "\\@")
    .trim());
  return truncateCharacters(sanitized, maximumLength);
}

function factText(value: FactValue): string {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => plain(item, 512)).join(", ");
  }
  return value === null ? "未设置" : plain(value, 1_024);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function boundedOutput(lines: string[]): string {
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  const suffix = "\n…[输出已截断]";
  const available = MAX_OUTPUT_BYTES - Buffer.byteLength(suffix, "utf8");
  return `${truncateUtf8(text, available)}${suffix}`;
}

function overflowAdvice(outcome: LookupOutcome & { kind: "overflow" }): string {
  switch (outcome.reason) {
    case "mixed_types":
      return "选区同时命中不同类型对象，请一次只选择一种对象。";
    case "ambiguous_normalized":
      return "规范化名称存在歧义，请选择更精确的对象 Key 或完整名称。";
    case "too_many":
      return "候选过多，未展示长列表。请缩小选区或使用上下文搜索。";
  }
}

export function renderLookupOutcome(outcome: LookupOutcome): string {
  switch (outcome.kind) {
    case "detail": {
      const detail = outcome.detail;
      const displayedSources = detail.sourceRefs.slice(0, 5);
      const remainingSources = detail.sourceRefs.length - displayedSources.length;
      const displayedFacts = Object.entries(detail.facts)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .slice(0, 5);
      const remainingFacts = Object.keys(detail.facts).length - displayedFacts.length;
      const lines = [
        `对象: ${plain(outcome.candidate.label, 512)} (${plain(detail.entityId, 256)})`,
        `类型: ${plain(detail.entityType, 256)}`,
        `上下文: ${plain(detail.scope.kind, 32)} · ${plain(detail.scope.namespace, 256)} · ${plain(detail.scope.id, 256)}`,
        `Freshness: ${plain(detail.freshness, 32)}`,
        `Revision: ${plain(detail.entityRevision, 512)}`,
        `Observed at: ${plain(detail.observedAt, 64)}`,
        `Verification: ${plain(outcome.verification.method, 32)}`,
        `Verified at: ${plain(outcome.verification.verifiedAt, 64)}`,
        ...(outcome.verification.method === "revision_check"
          ? [`Verified revision: ${plain(outcome.verification.verifiedRevision, 512)}`]
          : []),
        `Sources: ${displayedSources.length}/${detail.sourceRefs.length}${remainingSources > 0 ? ` (+${remainingSources} more)` : ""}`,
        ...displayedSources.flatMap((source, index) => [
          `Source ${index + 1} type: ${plain(source.sourceType, 128)}`,
          `Source ${index + 1} id: ${plain(source.sourceId, 256)}`,
        ]),
        `Facts: ${displayedFacts.length}/${Object.keys(detail.facts).length}${remainingFacts > 0 ? ` (+${remainingFacts} more)` : ""}`,
      ];
      for (const [key, value] of displayedFacts) {
        lines.push(`Fact[${plain(key, 128)}]: ${factText(value)}`);
      }
      return boundedOutput(lines);
    }
    case "candidates": {
      const displayedCandidates = outcome.candidates.slice(0, 3);
      const remainingCandidates = outcome.candidates.length - displayedCandidates.length;
      return boundedOutput([
        `发现 ${outcome.candidates.length} 个上下文对象，请选择：`,
        ...displayedCandidates.flatMap((candidate, index) => [
          `${index + 1}. ${plain(candidate.label, 512)} · ${plain(candidate.entityType, 256)} · ${plain(candidate.scope.kind, 32)}:${plain(candidate.scope.namespace, 256)}:${plain(candidate.scope.id, 256)} · ${plain(candidate.matchKind, 64)}`,
          `   摘要: ${plain(candidate.summary, 512)}`,
          `   详情新鲜度: ${plain(candidate.detailFreshness, 32)} · 索引于 ${plain(candidate.indexedAt, 64)} · 索引版本 ${plain(candidate.indexRevision, 128)}`,
        ]),
        ...(remainingCandidates > 0 ? [`其余 ${remainingCandidates} 个候选未展开。`] : []),
      ]);
    }
    case "no_match":
      return "当前上下文未找到匹配对象。请缩小选区或询问 Agent。";
    case "overflow":
      return boundedOutput([
        `发现 ${outcome.candidateCount} 个候选。`,
        overflowAdvice(outcome),
      ]);
    case "blocked":
      return `查询已阻止：${plain(outcome.reason, 128)}。`;
    case "unavailable":
      return `详情不可用：${plain(outcome.reason, 128)}${outcome.retryable ? "，可以重试" : ""}。`;
  }
}
