export type MarkdownBlock =
  | { readonly type: "blockquote"; readonly text: string }
  | { readonly type: "code"; readonly code: string; readonly language?: string }
  | { readonly type: "heading"; readonly level: number; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly MarkdownListItem[] }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "rule" }
  | { readonly type: "table"; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

interface MarkdownListItem {
  readonly text: string;
  readonly checked?: boolean;
}

const headingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const unorderedListPattern = /^\s{0,3}[-+*]\s+(.+)$/;
const orderedListPattern = /^\s{0,3}\d+[.)]\s+(.+)$/;
const quotePattern = /^\s{0,3}>\s?(.*)$/;
const rulePattern = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const tableDividerPattern = /^:?-{3,}:?$/;

function tableCells(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: readonly string[], index: number): boolean {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  const dividers = tableCells(lines[index + 1] ?? "");
  return dividers.length > 0 && dividers.every((cell) => tableDividerPattern.test(cell));
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    headingPattern.test(line) ||
    unorderedListPattern.test(line) ||
    orderedListPattern.test(line) ||
    quotePattern.test(line) ||
    rulePattern.test(line) ||
    fencePattern.test(line) ||
    isTableStart(lines, index)
  );
}

function listItem(text: string): MarkdownListItem {
  const task = /^\[([ xX])\]\s+(.+)$/.exec(text);
  return task ? { text: task[2] ?? "", checked: task[1]?.toLowerCase() === "x" } : { text };
}

export function parseMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = fencePattern.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const closingPattern = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closingPattern.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(fence[2] ? { type: "code", code: code.join("\n"), language: fence[2] } : { type: "code", code: code.join("\n") });
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (rulePattern.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = tableCells(line);
      const rows: (readonly string[])[] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const quote = quotePattern.exec(line);
    if (quote) {
      const quotedLines: string[] = [quote[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const nextQuote = quotePattern.exec(lines[index] ?? "");
        if (!nextQuote) break;
        quotedLines.push(nextQuote[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quotedLines.join(" ").trim() });
      continue;
    }

    const unordered = unorderedListPattern.exec(line);
    if (unordered) {
      const items: MarkdownListItem[] = [listItem(unordered[1] ?? "")];
      index += 1;
      while (index < lines.length) {
        const nextItem = unorderedListPattern.exec(lines[index] ?? "");
        if (!nextItem) break;
        items.push(listItem(nextItem[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    const ordered = orderedListPattern.exec(line);
    if (ordered) {
      const items: MarkdownListItem[] = [listItem(ordered[1] ?? "")];
      index += 1;
      while (index < lines.length) {
        const nextItem = orderedListPattern.exec(lines[index] ?? "");
        if (!nextItem) break;
        items.push(listItem(nextItem[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines, index)) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

export function safeLinkDestination(destination: string): string | undefined {
  const trimmed = destination.trim();
  if (/^(?:https?:\/\/|mailto:|\/|#|\.\.?\/)/i.test(trimmed)) return trimmed;
  return undefined;
}
