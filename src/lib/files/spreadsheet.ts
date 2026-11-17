import ExcelJS from "exceljs";

/**
 * Reading and writing spreadsheets in our own process.
 *
 * The alternative was to send the file to a spreadsheet service and get a URL
 * back, which means client data leaving the system and a dependency on someone
 * else's uptime. ExcelJS runs here: it parses the uploaded workbook and writes a
 * new one, so a project's numbers never travel further than our own container.
 *
 * Only values are preserved. Formulas are recalculated by the library when it
 * reads, so what a person edits is what they see; formatting (fonts, colours,
 * merged cells, charts) is lost on save. That is stated in the UI rather than
 * discovered afterwards.
 */

export interface SheetTable {
  name: string;
  rows: string[][];
}

export const MAX_SHEET_ROWS = 2000;
export const MAX_SHEET_COLUMNS = 60;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

export function isSpreadsheet(mimeType: string, name: string): boolean {
  const lowered = (mimeType || "").toLowerCase();
  if (lowered === XLSX_MIME || lowered === XLS_MIME) return true;
  return /\.(xlsx|xlsm|csv)$/i.test(name);
}

export function isCsv(mimeType: string, name: string): boolean {
  return (mimeType || "").toLowerCase().includes("csv") || /\.csv$/i.test(name);
}

export function xlsxMimeType(): string {
  return XLSX_MIME;
}

/** Excel cells arrive as objects; anything else is stringified. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    // Formulas, hyperlinks and rich text all carry their display value somewhere.
    if ("result" in candidate) return cellToText(candidate.result);
    if ("text" in candidate) return cellToText(candidate.text);
    if ("richText" in candidate && Array.isArray(candidate.richText)) {
      return (candidate.richText as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
    }
    if ("hyperlink" in candidate) return cellToText(candidate.hyperlink);
    if ("error" in candidate) return String(candidate.error ?? "");
  }
  return String(value);
}

/** Minimal RFC4180-style CSV split: quotes, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // handled by the \n branch
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell ?? "";
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(",")
    )
    .join("\r\n");
}

function clampRows(rows: string[][]): string[][] {
  return rows.slice(0, MAX_SHEET_ROWS).map((row) => row.slice(0, MAX_SHEET_COLUMNS));
}

export async function readSpreadsheet(params: {
  bytes: Buffer;
  mimeType: string;
  name: string;
}): Promise<SheetTable[]> {
  if (isCsv(params.mimeType, params.name)) {
    const rows = parseCsv(params.bytes.toString("utf8"));
    return [{ name: "Sheet1", rows: clampRows(rows) }];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(params.bytes as unknown as ArrayBuffer);
  const sheets: SheetTable[] = [];
  workbook.worksheets.forEach((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellToText(cell.value));
      });
      rows.push(cells);
    });
    sheets.push({ name: worksheet.name, rows: clampRows(rows) });
  });
  return sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] }];
}

export async function writeSpreadsheet(params: {
  sheets: SheetTable[];
  mimeType: string;
  name: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const tables = params.sheets.length > 0 ? params.sheets : [{ name: "Sheet1", rows: [] }];

  if (isCsv(params.mimeType, params.name)) {
    return { bytes: Buffer.from(serializeCsv(clampRows(tables[0].rows)), "utf8"), mimeType: "text/csv" };
  }

  const workbook = new ExcelJS.Workbook();
  for (const table of tables) {
    // Excel rejects sheet names with these characters, and empties.
    const safeName = (table.name || "Sheet").replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Sheet";
    const worksheet = workbook.addWorksheet(safeName);
    for (const row of clampRows(table.rows)) {
      worksheet.addRow(row);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return { bytes: Buffer.from(buffer as ArrayBuffer), mimeType: XLSX_MIME };
}
