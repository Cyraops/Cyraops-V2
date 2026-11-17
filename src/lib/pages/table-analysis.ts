/**
 * Table analysis for uploaded spreadsheets.
 *
 * The assistant could read a CSV as text, which is useless for "what is our
 * average deal size in this export". This profiles a table the way an analyst
 * would: inferred column types, null counts, numeric summary, and the most
 * common values for categorical columns.
 *
 * No code execution: the arithmetic happens here, bounded, so nothing the model
 * writes can run. That is a deliberate limit, not an oversight.
 */

import ExcelJS from "exceljs";
import { storage } from "@/lib/storage";
import { db } from "@/lib/db";

const MAX_ROWS = 20_000;

export interface ColumnProfile {
  name: string;
  type: "number" | "date" | "boolean" | "text" | "empty";
  filled: number;
  empty: number;
  distinct: number | null;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  median?: number;
  top?: Array<{ value: string; count: number }>;
}

export interface SheetProfile {
  sheet: string;
  rows: number;
  columns: number;
  probedRows: number;
  truncated: boolean;
  columns_profile: ColumnProfile[];
}

/** Minimal RFC4180-ish CSV parser: quotes, escaped quotes, CRLF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const DATEISH = /^\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/;

function inferType(values: string[]): ColumnProfile["type"] {
  const present = values.filter((v) => v !== "" && v !== null && v !== undefined);
  if (present.length === 0) return "empty";
  const asNumber = present.filter((v) => NUMERIC.test(v.replace(/[,\s₹$€£]/g, "")));
  if (asNumber.length >= present.length * 0.9) return "number";
  const asBool = present.filter((v) => /^(true|false|yes|no|y|n)$/i.test(v));
  if (asBool.length >= present.length * 0.9) return "boolean";
  const asDate = present.filter((v) => DATEISH.test(v));
  if (asDate.length >= present.length * 0.8) return "date";
  return "text";
}

const toNumber = (value: string) => Number(value.replace(/[,\s₹$€£]/g, ""));

/** Profile a matrix of string cells. Exported so it can be unit-tested. */
export function profileTable(sheet: string, matrix: string[][]): SheetProfile {
  const [headerRow, ...bodyRows] = matrix;
  if (!headerRow) return { sheet, rows: 0, columns: 0, probedRows: 0, truncated: false, columns_profile: [] };

  const columns = headerRow.length;
  const truncated = bodyRows.length > MAX_ROWS;
  const rows = bodyRows.slice(0, MAX_ROWS);

  const profile = headerRow.map((rawName, index) => {
    const name = (rawName || `Column ${index + 1}`).trim().slice(0, 60);
    const values = rows.map((row) => (row[index] ?? "").trim());
    const filledValues = values.filter((v) => v !== "");
    const type = inferType(filledValues);

    const column: ColumnProfile = {
      name,
      type,
      filled: filledValues.length,
      empty: values.length - filledValues.length,
      distinct: filledValues.length ? new Set(filledValues).size : 0,
    };

    if (type === "number") {
      const numbers = filledValues.map(toNumber).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (numbers.length) {
        const sum = numbers.reduce((a, b) => a + b, 0);
        column.min = Math.round(numbers[0] * 100) / 100;
        column.max = Math.round(numbers[numbers.length - 1] * 100) / 100;
        column.mean = Math.round((sum / numbers.length) * 100) / 100;
        column.sum = Math.round(sum * 100) / 100;
        const mid = Math.floor(numbers.length / 2);
        column.median = Math.round((numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2) * 100) / 100;
      }
    } else if (type === "text" || type === "boolean" || type === "date") {
      const counts = new Map<string, number>();
      for (const value of filledValues) counts.set(value, (counts.get(value) ?? 0) + 1);
      column.top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value: value.slice(0, 60), count }));
    }
    return column;
  });

  return { sheet, rows: bodyRows.length, columns, probedRows: rows.length, truncated, columns_profile: profile };
}

/** Read an uploaded table from storage and profile every sheet it contains. */
export async function analyseUploadedTable(attachmentId: string, userId: string) {
  const attachment = await db.messageAttachment.findFirst({
    where: { id: attachmentId },
    select: { id: true, name: true, storageKey: true, mimeType: true, uploadedById: true, message: { select: { conversationId: true } } },
  });
  if (!attachment) return { ok: false as const, error: "That file was not found" };
  if (!attachment.name.match(/\.(csv|xlsx|xlsm)$/i)) {
    return { ok: false as const, error: "Only .csv and .xlsx files can be analysed arithmetically" };
  }

  // Ownership: the uploader, or anyone who can see the conversation it was sent in.
  let allowed = attachment.uploadedById === userId;
  if (!allowed && attachment.message?.conversationId) {
    allowed = Boolean(
      await db.conversationMember.findFirst({
        where: { conversationId: attachment.message.conversationId, userId },
      })
    );
  }
  if (!allowed) return { ok: false as const, error: "You do not have access to that file" };

  const bytes = await storage.get(attachment.storageKey);
  const sheets: SheetProfile[] = [];

  if (/\.csv$/i.test(attachment.name)) {
    sheets.push(profileTable("csv", parseCsv(bytes.toString("utf8"))));
  } else {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
    for (const sheet of book.worksheets.slice(0, 5)) {
      const matrix: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        for (let i = 1; i <= Math.min(row.cellCount, 60); i += 1) {
          const value = row.getCell(i).value as unknown;
          if (value === null || value === undefined) values.push("");
          else if (typeof value === "object" && "text" in (value as object)) values.push(String((value as { text: unknown }).text ?? ""));
          else if (typeof value === "object" && "result" in (value as object)) values.push(String((value as { result: unknown }).result ?? ""));
          else if (value instanceof Date) values.push(value.toISOString().slice(0, 10));
          else values.push(String(value));
        }
        matrix.push(values);
      });
      sheets.push(profileTable(sheet.name, matrix));
    }
  }

  return { ok: true as const, file: attachment.name, sheets };
}
