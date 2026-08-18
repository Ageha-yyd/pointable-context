import assert from "node:assert/strict";
import test from "node:test";
import { extractMarkdownStructure } from "../src/adapters/markdown-artifact.js";

test("Markdown structure extracts one bounded human purpose and ordered headings", () => {
  const result = extractMarkdownStructure(`---
owner: platform
---
# Pointable **Context**

- status: active

Restores compressed development context without requiring another Chat Turn.

## Usage

\`\`\`text
# Not a heading
\`\`\`

### Safety
`);

  assert.equal(result.title, "Pointable Context");
  assert.equal(
    result.purpose,
    "Restores compressed development context without requiring another Chat Turn.",
  );
  assert.deepEqual(result.headings.map((heading) => heading.label), [
    "Pointable Context",
    "Usage",
    "Safety",
  ]);
});

test("Markdown structure ignores directives, tables, quotes, and truncates long prose", () => {
  const result = extractMarkdownStructure(`# Spec

> Historical note

| Key | Value |
|---|---|

![badge](badge.svg)

${"Useful deterministic purpose. ".repeat(30)}
`);
  assert.ok(result.purpose);
  assert.ok(result.purpose.length <= 360);
  assert.match(result.purpose, /^Useful deterministic purpose/u);
});
