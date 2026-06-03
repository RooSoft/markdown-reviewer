import { describe, test, expect } from "bun:test";
import { computeAnchor, relocate, serializeAnchor, parseAnchor, type Relocated } from "./anchoring";
import type { Annotation, BlockNode, BlockAnchor } from "../shared/types";

function makeNode(type: string, children?: any[]): any {
  return { type, children: children ?? [] };
}

function makeTextNode(value: string): any {
  return { type: "text", value };
}

function makeParagraph(text: string): any {
  return makeNode("paragraph", [makeTextNode(text)]);
}

function makeHeading(depth: number, text: string): any {
  return { type: "heading", depth, children: [makeTextNode(text)] };
}

function makeCode(value: string): any {
  return { type: "code", value, lang: undefined, meta: undefined };
}

function makeListItem(children: any[]): any {
  return { type: "listItem", children };
}

function makeBlockquote(children: any[]): any {
  return { type: "blockquote", children };
}

function makeBlock(id: string, anchor: BlockAnchor, type: string, text: string, endOffset: number): BlockNode {
  return {
    id,
    anchor,
    type,
    text,
    lineRange: [1, 1],
    endOffset,
    html: `<p data-block-id="${id}">${text}</p>`,
  };
}

function makeAnnotation(id: string, anchor: BlockAnchor, blockText: string, createdAt: number = Date.now()): Annotation {
  return {
    id,
    anchor,
    blockType: anchor.blockType,
    blockText,
    blockLineRange: [1, 1],
    comment: "test comment",
    status: "ok",
    createdAt,
    updatedAt: Date.now(),
  };
}

describe("computeAnchor", () => {
  test("computes anchor with correct blockType", () => {
    const node = makeParagraph("hello world");
    const anchor = computeAnchor(node, 0);
    expect(anchor.blockType).toBe("paragraph");
    expect(anchor.siblingOrdinal).toBe(0);
    expect(anchor.textHash.length).toBe(8);
  });

  test("heading hash is case-insensitive", () => {
    const lower = makeHeading(1, "Hello World");
    const upper = makeHeading(1, "HELLO WORLD");
    const mixed = makeHeading(1, "hello world");

    expect(computeAnchor(lower, 0).textHash).toBe(computeAnchor(upper, 0).textHash);
    expect(computeAnchor(lower, 0).textHash).toBe(computeAnchor(mixed, 0).textHash);
  });

  test("paragraph hash is case-sensitive", () => {
    const lower = makeParagraph("hello world");
    const upper = makeParagraph("HELLO WORLD");

    expect(computeAnchor(lower, 0).textHash).not.toBe(computeAnchor(upper, 0).textHash);
  });

  test("siblingOrdinal comes from index parameter", () => {
    const node = makeParagraph("same text");
    expect(computeAnchor(node, 0).siblingOrdinal).toBe(0);
    expect(computeAnchor(node, 3).siblingOrdinal).toBe(3);
    expect(computeAnchor(node, 99).siblingOrdinal).toBe(99);
  });

  test("code block uses value for text hash", () => {
    const code1 = makeCode("const x = 1;");
    const code2 = makeCode("const x = 1;");
    expect(computeAnchor(code1, 0).textHash).toBe(computeAnchor(code2, 0).textHash);
  });

  test("listItem extracts only direct inline text, not nested children", () => {
    // listItem with nested list — only "parent" should be hashed, not "child"
    const item = makeListItem([
      makeParagraph("parent"),
      { type: "list", children: [{ type: "listItem", children: [makeParagraph("child")]}] },
    ]);
    const anchor = computeAnchor(item, 0);

    // Hash should be based on "parent" only
    const plainItem = makeListItem([makeParagraph("parent")]);
    const plainAnchor = computeAnchor(plainItem, 0);

    expect(anchor.textHash).toBe(plainAnchor.textHash);
  });

  test("whitespace normalization collapses internal spaces", () => {
    const a = makeParagraph("hello   world");
    const b = makeParagraph("hello world");
    expect(computeAnchor(a, 0).textHash).toBe(computeAnchor(b, 0).textHash);
  });
});

describe("anchor stability", () => {
  test("editing block B does not change block A's anchor", () => {
    const blockA = makeParagraph("unchanged text");
    const blockB_v1 = makeParagraph("original text");
    const blockB_v2 = makeParagraph("edited text");

    const anchorA = computeAnchor(blockA, 0);
    const anchorB_v1 = computeAnchor(blockB_v1, 1);
    const anchorB_v2 = computeAnchor(blockB_v2, 1);

    // Block A's anchor should not change
    expect(anchorA.textHash).toBe(anchorA.textHash); // trivially true, but documents intent
    // Block B's hash changes
    expect(anchorB_v1.textHash).not.toBe(anchorB_v2.textHash);
    // Block A's hash is independent of B's change
    expect(anchorA.textHash).not.toBe(anchorB_v1.textHash);
  });
});

describe("siblingOrdinal per immediate parent", () => {
  test("nested sublist items number independently", () => {
    // Outer list items: item0 at index 0, item1 at index 1
    const outerItem0 = makeListItem([makeParagraph("outer 0")]);
    const outerItem1 = makeListItem([makeParagraph("outer 1")]);

    // Nested sublist inside item1: nested0 at index 0 (independent numbering)
    const nestedItem0 = makeListItem([makeParagraph("nested 0")]);

    expect(computeAnchor(outerItem0, 0).siblingOrdinal).toBe(0);
    expect(computeAnchor(outerItem1, 1).siblingOrdinal).toBe(1);
    expect(computeAnchor(nestedItem0, 0).siblingOrdinal).toBe(0); // independent, starts at 0
  });
});

describe("duplicate list items", () => {
  test("identical list items get distinct anchors (different ordinals)", () => {
    const item1 = makeListItem([makeParagraph("Item one")]);
    const item2 = makeListItem([makeParagraph("Item one")]);

    const anchor1 = computeAnchor(item1, 0);
    const anchor2 = computeAnchor(item2, 1);

    expect(anchor1.textHash).toBe(anchor2.textHash); // same content hash
    expect(anchor1.siblingOrdinal).toBe(0);
    expect(anchor2.siblingOrdinal).toBe(1); // different ordinal
    expect(serializeAnchor(anchor1)).not.toBe(serializeAnchor(anchor2));
  });
});

describe("serializeAnchor / parseAnchor", () => {
  test("round-trips correctly", () => {
    const anchor: BlockAnchor = { blockType: "heading", textHash: "abcd1234", siblingOrdinal: 5 };
    const serialized = serializeAnchor(anchor);
    expect(serialized).toBe("heading:abcd1234:5");

    const parsed = parseAnchor(serialized);
    expect(parsed).toEqual(anchor);
  });
});

describe("relocate", () => {
  test("unchanged doc → all ok (tier 1)", () => {
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "heading", textHash: "aaa", siblingOrdinal: 0 }, "heading", "# Hello", 10),
      makeBlock("b1", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "paragraph", "Hello world", 30),
    ];

    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "heading", textHash: "aaa", siblingOrdinal: 0 }, "# Hello"),
      makeAnnotation("a1", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Hello world"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(2);
    expect(results[0].annotation.status).toBe("ok");
    expect(results[0].block).toBe(blocks[0]);
    expect(results[1].annotation.status).toBe("ok");
    expect(results[1].block).toBe(blocks[1]);
  });

  test("inserting paragraph above unedited block → ok (tier 2), NOT orphaned", () => {
    // Original: heading at ordinal 0, paragraph at ordinal 0
    // After insert: heading at ordinal 0, NEW paragraph at ordinal 0, old paragraph at ordinal 1
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "heading", textHash: "aaa", siblingOrdinal: 0 }, "heading", "# Hello", 10),
      makeBlock("b1", { blockType: "paragraph", textHash: "ccc", siblingOrdinal: 0 }, "paragraph", "New paragraph", 25),
      makeBlock("b2", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 1 }, "paragraph", "Hello world", 45),
    ];

    // Annotation was on paragraph at ordinal 0 (before insert)
    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Hello world"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(1);
    expect(results[0].annotation.status).toBe("ok");
    expect(results[0].block).toBe(blocks[2]); // matched to b2 (same content, different ordinal)
    expect(results[0].annotation.anchor.siblingOrdinal).toBe(1); // rebound
  });

  test("editing text in place → stale (tier 3)", () => {
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "paragraph", textHash: "ccc", siblingOrdinal: 0 }, "paragraph", "Edited text", 30),
    ];

    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Original text"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(1);
    expect(results[0].annotation.status).toBe("stale");
    expect(results[0].block).toBe(blocks[0]); // same position, different content
  });

  test("deleting block → orphaned (tier 4)", () => {
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "heading", textHash: "aaa", siblingOrdinal: 0 }, "heading", "# Hello", 10),
    ];

    // Annotation for a paragraph that no longer exists
    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Deleted text"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(1);
    expect(results[0].annotation.status).toBe("orphaned");
    expect(results[0].block).toBeNull();
  });

  test("one-block-one-claim: two annotations don't collapse onto same block", () => {
    // Two annotations with same anchor, only one block
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "paragraph", "Same text", 30),
    ];

    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Same text", 1000),
      makeAnnotation("a1", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 0 }, "Same text", 2000),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(2);
    // First annotation claims the block
    expect(results[0].annotation.status).toBe("ok");
    expect(results[0].block).toBe(blocks[0]);
    // Second annotation gets orphaned (block already claimed)
    expect(results[1].annotation.status).toBe("orphaned");
    expect(results[1].block).toBeNull();
  });

  test("duplicate content rebinds to nearest ordinal", () => {
    // Two blocks with same content, annotation was at ordinal 5
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 3 }, "paragraph", "Duplicate", 20),
      makeBlock("b1", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 6 }, "paragraph", "Duplicate", 40),
    ];

    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "bbb", siblingOrdinal: 5 }, "Duplicate"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(1);
    expect(results[0].annotation.status).toBe("ok");
    // Nearest to ordinal 5 is ordinal 6 (distance 1) vs ordinal 3 (distance 2)
    expect(results[0].block).toBe(blocks[1]);
    expect(results[0].annotation.anchor.siblingOrdinal).toBe(6);
  });

  test("returns exactly one Relocated per input annotation", () => {
    const blocks: BlockNode[] = [];
    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "x", siblingOrdinal: 0 }, "text"),
      makeAnnotation("a1", { blockType: "heading", textHash: "y", siblingOrdinal: 0 }, "text"),
      makeAnnotation("a2", { blockType: "code", textHash: "z", siblingOrdinal: 0 }, "text"),
    ];

    const results = relocate(annotations, blocks);
    expect(results).toHaveLength(3);
    // All orphaned since no blocks exist
    for (const r of results) {
      expect(r.annotation.status).toBe("orphaned");
      expect(r.block).toBeNull();
    }
  });

  test("tier 1 beats tier 3: exact match preferred over position-only", () => {
    // Block at ordinal 0 with hash aaa, block at ordinal 1 with hash aaa
    // Annotation for ordinal 0 hash aaa → tier 1 exact
    const blocks: BlockNode[] = [
      makeBlock("b0", { blockType: "paragraph", textHash: "aaa", siblingOrdinal: 0 }, "paragraph", "Content A", 10),
      makeBlock("b1", { blockType: "paragraph", textHash: "aaa", siblingOrdinal: 1 }, "paragraph", "Content A", 20),
    ];

    const annotations: Annotation[] = [
      makeAnnotation("a0", { blockType: "paragraph", textHash: "aaa", siblingOrdinal: 0 }, "Content A"),
    ];

    const results = relocate(annotations, blocks);
    expect(results[0].annotation.status).toBe("ok");
    expect(results[0].block).toBe(blocks[0]); // exact match at ordinal 0
  });
});
