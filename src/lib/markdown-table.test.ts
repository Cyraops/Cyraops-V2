/**
 * Unit tests for the markdown table renderer's pure helpers.
 *
 * The hydration fix: react-markdown passes the `table` component the table's
 * SECTIONS (thead + tbody) as children, not a `<table>` element. The old
 * extraction unwrapped one level too deep, grabbed the `thead` element as the
 * "table", and ended up rendering `<th>` cells directly inside `<tbody>` —
 * the invalid nesting behind the "th cannot be a child of tbody" hydration
 * warning. These tests pin the corrected section/row/cell extraction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { closeOpenFence, MdThead, splitBlocks, tablePartsOf } from "../components/ai/markdown";

function td(text: string): React.ReactElement {
  return React.createElement("td", null, text);
}

function th(text: string): React.ReactElement {
  return React.createElement("th", null, text);
}

function tr(cells: React.ReactElement[]): React.ReactElement {
  return React.createElement("tr", null, cells);
}

describe("markdown table section extraction", () => {
  it("splits children into the header cells and the body rows", () => {
    const head = React.createElement(MdThead, null, tr([th("Task"), th("Status")]));
    const body = React.createElement(
      "tbody",
      null,
      [tr([td("Restore backups"), td("To Do")]), tr([td("Billing webhooks"), td("In Progress")])]
    );

    const parts = tablePartsOf([head, body]);

    assert.ok(parts.head, "thead section must be found");
    assert.equal(parts.headCells.length, 2);
    assert.equal(parts.rows.length, 2);
    assert.deepEqual(parts.rows[0].text, ["Restore backups", "To Do"]);
    assert.deepEqual(parts.rows[1].text, ["Billing webhooks", "In Progress"]);
  });

  it("keeps body rows as tr elements — never header cells inside the body (hydration fix)", () => {
    const head = React.createElement(MdThead, null, tr([th("A"), th("B")]));
    const body = React.createElement("tbody", null, [tr([td("1"), td("2")]), tr([td("3"), td("4")])]);

    const parts = tablePartsOf([head, body]);

    for (const row of parts.rows) {
      assert.equal(row.node.type, "tr", "body rows must be <tr> elements");
    }
    // The regression this pins: the old code surfaced <th> cells as the body
    // rows, which React renders directly inside <tbody> (invalid HTML).
    for (const cell of parts.headCells) {
      assert.equal(cell.type, "th");
    }
  });

  it("falls back to the first section when a table has no thead", () => {
    const body = React.createElement("tbody", null, [tr([td("1"), td("2")])]);
    const parts = tablePartsOf([body]);

    assert.equal(parts.head, null);
    assert.equal(parts.rawRows.length, 1);
    assert.equal(parts.rows.length, 1);
    assert.deepEqual(parts.rows[0].text, ["1", "2"]);
  });

  it("handles an empty table with no sections", () => {
    const parts = tablePartsOf([]);
    assert.equal(parts.head, null);
    assert.equal(parts.headCells.length, 0);
    assert.equal(parts.rows.length, 0);
  });
});

describe("markdown streaming block helpers", () => {
  it("splits source text into blocks on blank lines", () => {
    assert.deepEqual(splitBlocks("hello\n\nworld"), ["hello", "world"]);
    assert.deepEqual(splitBlocks("one line"), ["one line"]);
    assert.deepEqual(splitBlocks(""), []);
  });

  it("keeps blank lines inside fenced code blocks together", () => {
    const source = "```ts\nconst x = 1;\n\nconst y = 2;\n```\n\nafter";
    const blocks = splitBlocks(source);
    assert.equal(blocks.length, 2);
    assert.ok(blocks[0].startsWith("```ts"));
    assert.ok(blocks[0].includes("\n\n"));
  });

  it("closes a fence left open mid-stream", () => {
    assert.equal(closeOpenFence("```ts\ncode"), "```ts\ncode\n```");
    assert.equal(closeOpenFence("```ts\ncode\n```"), "```ts\ncode\n```");
    assert.equal(closeOpenFence("plain text"), "plain text");
  });
});
