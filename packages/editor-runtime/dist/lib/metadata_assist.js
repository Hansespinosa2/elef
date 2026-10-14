import { frontmatterRangeFor } from "@elef/client";
import {
  MARGIN_SETTING_KEYS,
  METADATA_TOP_LEVEL_KEYS,
  metadataValueChoices
} from "@elef/work-model";
function metadataQueryAt(source, caret) {
  if (typeof source !== "string" || caret < 0 || caret > source.length) return null;
  const range = frontmatterRangeFor(source);
  if (!range || caret < range.from || caret > range.to) return null;
  const block = source.slice(range.from, range.to);
  const offset = caret - range.from;
  const lineStart = block.lastIndexOf("\n", offset - 1) + 1;
  const lineEndIndex = block.indexOf("\n", offset);
  const lineEnd = lineEndIndex < 0 ? block.length : lineEndIndex;
  const line = block.slice(lineStart, lineEnd);
  const beforeCaret = block.slice(lineStart, offset);
  const lineNumber = block.slice(0, lineStart).split("\n").length;
  if (lineNumber === 1) return null;
  if (/^[ \t]*---[ \t]*$/.test(line)) return null;
  if (beforeCaret.includes("\n")) return null;
  const colonIndex = beforeCaret.indexOf(":");
  if (colonIndex >= 0) {
    const key = beforeCaret.slice(0, colonIndex).trim();
    if (!/^[A-Za-z_][\w-]*$/.test(key)) return null;
    const choices = metadataValueChoices(key);
    if (!choices) return null;
    const rawValue = beforeCaret.slice(colonIndex + 1);
    if (rawValue.includes("#")) return null;
    const leadingSpaces = rawValue.match(/^[ \t]*/)?.[0] ?? "";
    const queryText = rawValue.slice(leadingSpaces.length);
    if (/["']/.test(queryText)) return null;
    if (queryText.includes(" ") || queryText.includes("	")) return null;
    return {
      kind: "value",
      text: queryText.toLowerCase(),
      start: range.from + lineStart + colonIndex + 1 + leadingSpaces.length,
      key
    };
  }
  if (/^[ \t]*[A-Za-z_-]*$/.test(beforeCaret)) {
    const trimmed = beforeCaret.trim();
    const queryText = trimmed.toLowerCase();
    const leadingSpaces = beforeCaret.match(/^[ \t]*/)?.[0] ?? "";
    return {
      kind: "key",
      text: queryText,
      start: range.from + lineStart + leadingSpaces.length,
      nested: /^[ \t]+/.test(beforeCaret)
    };
  }
  return null;
}
function fieldScore(value, query, weight) {
  const foldedValue = value.toLowerCase();
  const foldedQuery = query.toLowerCase();
  if (!query) return weight;
  if (value === query) return weight + 1e3;
  if (foldedValue === foldedQuery) return weight + 900;
  if (value.startsWith(query)) return weight + 800 - value.length;
  if (foldedValue.startsWith(foldedQuery)) return weight + 700 - value.length;
  if (query.length < 2) return null;
  const exactIndex = value.indexOf(query);
  if (exactIndex !== -1) return weight + 600 - exactIndex;
  const foldedIndex = foldedValue.indexOf(foldedQuery);
  if (foldedIndex !== -1) return weight + 500 - foldedIndex;
  let previous = -1;
  let gap = 0;
  for (const character of foldedQuery) {
    const index = foldedValue.indexOf(character, previous + 1);
    if (index === -1) return null;
    if (previous !== -1) gap += index - previous - 1;
    previous = index;
  }
  return weight + 300 - gap - previous / 100;
}
function rankMetadataCandidates(candidates, query) {
  return candidates.map((candidate) => ({ candidate, score: fieldScore(candidate, query, 9e3) })).filter((result) => result.score !== null).sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate)).map((result) => result.candidate);
}
function metadataCandidatesFor(query) {
  if (query.kind === "key") {
    return query.nested ? [...MARGIN_SETTING_KEYS] : [...METADATA_TOP_LEVEL_KEYS];
  }
  return metadataValueChoices(query.key ?? "") ?? [];
}
export {
  fieldScore,
  metadataCandidatesFor,
  metadataQueryAt,
  rankMetadataCandidates
};
