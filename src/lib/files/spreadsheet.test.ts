import test from "node:test";
import assert from "node:assert/strict";
import {
  isSpreadsheet,
  isCsv,
  parseCsv,
  serializeCsv,
  readSpreadsheet,
  writeSpreadsheet,
} from "./spreadsheet";

/**
 * The editor is only as trustworthy as this round-trip: read a workbook, hand a
 * grid to the UI, write it back, and get the same values. A spreadsheet edit that
 * silently drops a column is worse than no editor at all.
 */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("recognises spreadsheets by type or extension", () => {
  assert.equal(isSpreadsheet(XLSX, "book.xlsx"), true);
  assert.equal(isSpreadsheet("", "book.csv"), true);
  assert.equal(isSpreadsheet("text/plain", "notes.txt"), false);
  assert.equal(isCsv("text/csv", "a.csv"), true);
  assert.equal(isCsv(XLSX, "a.xlsx"), false);
});

test("parses quoted CSV including embedded commas, quotes and newlines", () => {
  const rows = parseCsv('name,note\nNorthwind,"retainer, phase 2"\nACME,"said ""maybe"" once"\nMulti,"line one\nline two"');
  assert.deepEqual(rows[0], ["name", "note"]);
  assert.deepEqual(rows[1], ["Northwind", "retainer, phase 2"]);
  assert.deepEqual(rows[2], ["ACME", 'said "maybe" once']);
  assert.deepEqual(rows[3], ["Multi", "line one\nline two"]);
});

test("serialises CSV so that parsing it again gives the same grid", () => {
  const grid = [
    ["name", "note"],
    ["Northwind", "retainer, phase 2"],
    ["ACME", 'said "maybe" once'],
  ];
  assert.deepEqual(parseCsv(serializeCsv(grid)), grid);
});

test("a workbook survives a write/read round trip with every cell intact", async () => {
  const sheets = [
    { name: "Pipeline", rows: [["Client", "Value", "Stage"], ["Northwind", "18000", "Discovery"], ["ACME", "", "Closing"]] },
    { name: "Notes", rows: [["line one"], ["line two"]] },
  ];

  const written = await writeSpreadsheet({ sheets, mimeType: XLSX, name: "book.xlsx" });
  assert.ok(written.bytes.byteLength > 0, "the workbook was written");
  assert.equal(written.mimeType, XLSX);

  const readBack = await readSpreadsheet({ bytes: written.bytes, mimeType: XLSX, name: "book.xlsx" });
  assert.equal(readBack.length, 2, "both sheets survive");
  assert.equal(readBack[0].name, "Pipeline");
  assert.deepEqual(readBack[0].rows, sheets[0].rows);
  assert.deepEqual(readBack[1].rows, sheets[1].rows);
});

test("an edited value is what is written back", async () => {
  const original = await writeSpreadsheet({
    sheets: [{ name: "Sheet1", rows: [["Client", "Value"], ["Northwind", "18000"]] }],
    mimeType: XLSX,
    name: "book.xlsx",
  });
  const parsed = await readSpreadsheet({ bytes: original.bytes, mimeType: XLSX, name: "book.xlsx" });

  // The UI edits a cell in place, then saves the whole grid.
  parsed[0].rows[1][1] = "24000";
  const saved = await writeSpreadsheet({ sheets: parsed, mimeType: XLSX, name: "book.xlsx" });
  const reread = await readSpreadsheet({ bytes: saved.bytes, mimeType: XLSX, name: "book.xlsx" });

  assert.equal(reread[0].rows[1][1], "24000");
  assert.equal(reread[0].rows[0][0], "Client", "headers are untouched");
});

test("sheet names Excel would reject are made safe instead of failing the save", async () => {
  const written = await writeSpreadsheet({
    sheets: [{ name: "Q3/2026 [draft]", rows: [["x"]] }],
    mimeType: XLSX,
    name: "book.xlsx",
  });
  const readBack = await readSpreadsheet({ bytes: written.bytes, mimeType: XLSX, name: "book.xlsx" });
  assert.ok(!/[\\/*?:[\]]/.test(readBack[0].name), `name still has forbidden characters: ${readBack[0].name}`);
  assert.equal(readBack[0].rows[0][0], "x");
});

test("CSV round trip through the same read/write path keeps the grid", async () => {
  const written = await writeSpreadsheet({
    sheets: [{ name: "Sheet1", rows: [["Client", "Value"], ["Northwind", "18,000"]] }],
    mimeType: "text/csv",
    name: "export.csv",
  });
  const readBack = await readSpreadsheet({ bytes: written.bytes, mimeType: "text/csv", name: "export.csv" });
  assert.deepEqual(readBack[0].rows, [["Client", "Value"], ["Northwind", "18,000"]]);
});

test("empty sheets are still valid workbooks", async () => {
  const written = await writeSpreadsheet({ sheets: [], mimeType: XLSX, name: "blank.xlsx" });
  const readBack = await readSpreadsheet({ bytes: written.bytes, mimeType: XLSX, name: "blank.xlsx" });
  assert.equal(readBack.length, 1);
  assert.deepEqual(readBack[0].rows, []);
});
