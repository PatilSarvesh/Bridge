import { Fragment, type ReactNode } from "react";

import { type MarkdownBlock, parseMarkdown, safeLinkDestination } from "./markdown-parser";

interface MarkdownDocumentProps {
  readonly headingLevelOffset?: number;
  readonly omitLeadingHeading?: boolean;
  readonly source: string;
}

function inlineContent(text: string): readonly ReactNode[] {
  const tokenPattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    const key = `${start}-${token}`;

    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const destination = safeLinkDestination(link?.[2] ?? "");
      nodes.push(
        destination ? <a href={destination} key={key} rel="noreferrer" target={destination.startsWith("http") ? "_blank" : undefined}>{link?.[1]}</a> : <Fragment key={key}>{link?.[1] ?? token}</Fragment>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function heading(block: Extract<MarkdownBlock, { readonly type: "heading" }>, key: string, levelOffset: number): ReactNode {
  const content = inlineContent(block.text);
  const renderedLevel = Math.min(6, block.level + levelOffset);
  if (renderedLevel === 1) return <h1 key={key}>{content}</h1>;
  if (renderedLevel === 2) return <h2 key={key}>{content}</h2>;
  if (renderedLevel === 3) return <h3 key={key}>{content}</h3>;
  if (renderedLevel === 4) return <h4 key={key}>{content}</h4>;
  if (renderedLevel === 5) return <h5 key={key}>{content}</h5>;
  return <h6 key={key}>{content}</h6>;
}

export function MarkdownDocument({ headingLevelOffset = 0, omitLeadingHeading = false, source }: MarkdownDocumentProps) {
  const parsedBlocks = parseMarkdown(source);
  const blocks = omitLeadingHeading && parsedBlocks[0]?.type === "heading" ? parsedBlocks.slice(1) : parsedBlocks;

  return (
    <div className="markdown-document">
      {blocks.map((block, blockIndex) => {
        const key = `${block.type}-${blockIndex}`;
        if (block.type === "heading") return heading(block, key, headingLevelOffset);
        if (block.type === "paragraph") return <p key={key}>{inlineContent(block.text)}</p>;
        if (block.type === "blockquote") return <blockquote key={key}>{inlineContent(block.text)}</blockquote>;
        if (block.type === "rule") return <hr key={key} />;
        if (block.type === "code") {
          return <figure className="markdown-code" key={key}>{block.language ? <figcaption>{block.language}</figcaption> : null}<pre><code>{block.code}</code></pre></figure>;
        }
        if (block.type === "table") {
          return (
            <div className="markdown-table-wrap" key={key}>
              <table>
                <thead><tr>{block.headers.map((cell, cellIndex) => <th key={`${cell}-${cellIndex}`}>{inlineContent(cell)}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{block.headers.map((_, cellIndex) => <td key={`cell-${cellIndex}`}>{inlineContent(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }

        const List = block.ordered ? "ol" : "ul";
        return (
          <List className={block.items.some((item) => item.checked !== undefined) ? "task-list" : undefined} key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${item.text}-${itemIndex}`}>
                {item.checked !== undefined ? <span className={item.checked ? "task-marker checked" : "task-marker"} aria-label={item.checked ? "Complete" : "Incomplete"}>{item.checked ? "✓" : ""}</span> : null}
                <span>{inlineContent(item.text)}</span>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
