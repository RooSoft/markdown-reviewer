import { describe, test, expect } from "bun:test";
import { parseDocument, loadDocument } from "./markdown-service";

describe("parseDocument", () => {
  test("returns source and blocks", () => {
    const source = "# Hello\n\nWorld";
    const { source: returnedSource, blocks } = parseDocument(source);
    expect(returnedSource).toBe(source);
    expect(blocks.length).toBeGreaterThan(0);
  });

  test("renders headings with data-block-id", () => {
    const { blocks } = parseDocument("# Hello\n\n## World");
    const headingBlocks = blocks.filter((b) => b.type === "heading");
    expect(headingBlocks).toHaveLength(2);
    for (const block of headingBlocks) {
      expect(block.html).toContain(`data-block-id="${block.id}"`);
    }
  });

  test("renders paragraphs with data-block-id", () => {
    const { blocks } = parseDocument("Hello world\n\nFoo bar");
    const paraBlocks = blocks.filter((b) => b.type === "paragraph");
    expect(paraBlocks).toHaveLength(2);
    for (const block of paraBlocks) {
      expect(block.html).toContain(`data-block-id="${block.id}"`);
    }
  });

  test("renders list items with data-block-id on <li>", () => {
    const { blocks } = parseDocument("- Item one\n- Item two");
    const liBlocks = blocks.filter((b) => b.type === "listItem");
    expect(liBlocks).toHaveLength(2);
    for (const block of liBlocks) {
      expect(block.html).toContain(`data-block-id="${block.id}"`);
      // data-block-id should be on the <li> element
      expect(block.html).toMatch(/<li[^>]*data-block-id/);
    }
  });

  test("renders code blocks with data-block-id", () => {
    const { blocks } = parseDocument("```\ncode here\n```");
    const codeBlocks = blocks.filter((b) => b.type === "code");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0].html).toContain(`data-block-id="${codeBlocks[0].id}"`);
  });

  test("renders blockquotes with data-block-id", () => {
    const { blocks } = parseDocument("> This is a quote");
    const bqBlocks = blocks.filter((b) => b.type === "blockquote");
    expect(bqBlocks).toHaveLength(1);
    expect(bqBlocks[0].html).toContain(`data-block-id="${bqBlocks[0].id}"`);
  });

  test("renders table cells with data-block-id", () => {
    const { blocks } = parseDocument("| A | B |\n|---|---|\n| 1 | 2 |");
    const cellBlocks = blocks.filter((b) => b.type === "tableCell");
    expect(cellBlocks.length).toBeGreaterThan(0);
    for (const block of cellBlocks) {
      expect(block.html).toContain(`data-block-id="${block.id}"`);
    }
  });

  test("no data-block-id on frontmatter", () => {
    const { blocks } = parseDocument("---\ntitle: test\n---\n\nHello");
    const fmBlocks = blocks.filter((b) => b.type === "yaml" || b.type === "toml");
    expect(fmBlocks).toHaveLength(0);
    // No block should have a yaml/toml type
    for (const block of blocks) {
      expect(block.type).not.toBe("yaml");
      expect(block.type).not.toBe("toml");
    }
  });

  test("no data-block-id on thematicBreak", () => {
    const { blocks } = parseDocument("Hello\n\n---\n\nWorld");
    const tbBlocks = blocks.filter((b) => b.type === "thematicBreak");
    expect(tbBlocks).toHaveLength(0);
  });

  test("no data-block-id on raw HTML blocks", () => {
    const { blocks } = parseDocument("<div>raw html</div>\n\nHello");
    const htmlBlocks = blocks.filter((b) => b.type === "html");
    expect(htmlBlocks).toHaveLength(0);
  });

  test("list-item id on <li>, no phantom id on dropped <p>", () => {
    const { blocks } = parseDocument("- Item one\n- Item two");
    const liBlocks = blocks.filter((b) => b.type === "listItem");
    expect(liBlocks).toHaveLength(2);

    // In a tight list, remark-rehype drops the <p> wrapper.
    // The data-block-id should be on the <li>, not on a <p> inside.
    for (const block of liBlocks) {
      expect(block.html).toMatch(/<li[^>]*data-block-id/);
      // There should NOT be a <p data-block-id> inside the li
      // In tight lists, there is no <p> at all
      const hasPWithDataBlockId = /<p[^>]*data-block-id/.test(block.html);
      // If there's a <p> with data-block-id, that's a phantom id
      // (only happens in loose lists where <p> is preserved, but we skip those)
      expect(hasPWithDataBlockId).toBe(false);
    }
  });

  test("endOffset is populated correctly", () => {
    const source = "# Hello\n\nWorld";
    const { blocks } = parseDocument(source);
    for (const block of blocks) {
      expect(block.endOffset).toBeGreaterThan(0);
      expect(typeof block.endOffset).toBe("number");
    }
  });

  test("ids are sequential (b0, b1, b2, ...)", () => {
    const { blocks } = parseDocument("# H1\n\nPara 1\n\nPara 2");
    expect(blocks[0].id).toBe("b0");
    expect(blocks[1].id).toBe("b1");
    expect(blocks[2].id).toBe("b2");
  });

  test("anchor is present on every block", () => {
    const { blocks } = parseDocument("# Hello\n\nWorld");
    for (const block of blocks) {
      expect(block.anchor.blockType).toBe(block.type);
      expect(block.anchor.textHash.length).toBe(8);
      expect(typeof block.anchor.siblingOrdinal).toBe("number");
    }
  });

  test("lineRange is advisory (present but not used for relocation)", () => {
    const { blocks } = parseDocument("# Hello\n\nWorld\n\nThird");
    for (const block of blocks) {
      expect(block.lineRange).toHaveLength(2);
      expect(block.lineRange[0]).toBeGreaterThanOrEqual(1);
      expect(block.lineRange[1]).toBeGreaterThanOrEqual(block.lineRange[0]);
    }
  });

  test("mixed document has correct block count", () => {
    const source = `# Title

Some paragraph.

- List item 1
- List item 2

> A quote

\`\`\`
code
\`\`\`

| A | B |
|---|---|
| 1 | 2 |`;

    const { blocks } = parseDocument(source);
    // heading(1) + paragraph(1) + listItem(2) + blockquote(1) + code(1) + tableCell(4) = 10
    expect(blocks.length).toBe(10);
  });

  test("blockquote extracts text from direct content", () => {
    const { blocks } = parseDocument("> This is a quote");
    const bq = blocks.find((b) => b.type === "blockquote");
    expect(bq).toBeDefined();
    expect(bq!.text).toContain("This is a quote");
  });

  test("code block text is the code content", () => {
    const { blocks } = parseDocument("```\nconst x = 1;\n```");
    const code = blocks.find((b) => b.type === "code");
    expect(code).toBeDefined();
    expect(code!.text).toContain("const x = 1;");
  });
});

describe("loadDocument", () => {
  test("reads file and returns fileHash", async () => {
    const tmpFile = Bun.write("/tmp/test-md-load.md", "# Hello\n\nWorld");
    const result = await loadDocument("/tmp/test-md-load.md");
    expect(result.source).toBe("# Hello\n\nWorld");
    expect(result.fileHash.length).toBe(64); // SHA-256 hex
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  test("fileHash is stable for same content", async () => {
    const result1 = await loadDocument("/tmp/test-md-load.md");
    const result2 = await loadDocument("/tmp/test-md-load.md");
    expect(result1.fileHash).toBe(result2.fileHash);
  });
});
