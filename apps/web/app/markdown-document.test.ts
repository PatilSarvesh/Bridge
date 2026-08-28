import { describe, expect, it } from "vitest";

import { parseMarkdown, safeLinkDestination } from "./markdown-parser";

describe("MarkdownDocument", () => {
  it("parses common specification structures into readable blocks", () => {
    const blocks = parseMarkdown(`# Product requirements

Readable context over
multiple source lines.

- First requirement
- [x] Reviewed requirement

| Owner | State |
| --- | --- |
| Human | Approved |

\`\`\`ts
const authority = "human";
\`\`\``);

    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "table", "code"]);
    expect(blocks[1]).toMatchObject({ type: "paragraph", text: "Readable context over multiple source lines." });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
  });

  it("allows only bounded link destinations", () => {
    expect(safeLinkDestination("https://example.com/guide")).toBe("https://example.com/guide");
    expect(safeLinkDestination("/docs/specification")).toBe("/docs/specification");
    expect(safeLinkDestination("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkDestination("data:text/html,unsafe")).toBeUndefined();
  });
});
