"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Plus, Save, Table2, X } from "lucide-react";
import { Button, Modal, useToast } from "@/components/ui";

/**
 * A file, opened inside the product.
 *
 * Spreadsheets are edited in place and saved back to the same record; images and
 * PDFs are rendered from our own download route; text is shown read-only. No part
 * of this calls out to a third party — the bytes come from our storage, are parsed
 * by our server, and are written back to our storage.
 */

type SheetTable = { name: string; rows: string[][] };

type Payload =
  | { kind: "sheet"; sheets: SheetTable[]; editable: boolean; note?: string }
  | { kind: "image"; url: string; mimeType: string }
  | { kind: "pdf"; url: string; mimeType: string }
  | { kind: "text"; text: string; truncated: boolean; editable: boolean }
  | { kind: "unsupported"; mimeType: string; reason?: string };

export function FileViewer({
  file,
  onClose,
  onSaved,
}: {
  file: { id: string; name: string; mimeType: string; size: number } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sheets, setSheets] = useState<SheetTable[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  const load = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setDirty(false);
    setActiveSheet(0);
    try {
      const response = await fetch(`/api/files/${file.id}/editor`);
      const data = (await response.json().catch(() => ({}))) as Payload & { error?: string };
      if (!response.ok) {
        toast(data.error ?? "Could not open that file", "error");
        setPayload(null);
        return;
      }
      setPayload(data);
      if (data.kind === "sheet") setSheets(data.sheets);
    } finally {
      setLoading(false);
    }
  }, [file, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const table = sheets[activeSheet] ?? { name: "Sheet1", rows: [] };
  const rowCount = table.rows.length;
  const columnCount = useMemo(
    () => table.rows.reduce((widest, row) => Math.max(widest, row.length), 0),
    [table.rows]
  );

  const editCell = (rowIndex: number, columnIndex: number, value: string) => {
    setSheets((prev) =>
      prev.map((sheet, index) => {
        if (index !== activeSheet) return sheet;
        const rows = sheet.rows.map((row) => [...row]);
        while (rows.length <= rowIndex) rows.push([]);
        const target = rows[rowIndex];
        while (target.length <= columnIndex) target.push("");
        target[columnIndex] = value;
        return { ...sheet, rows };
      })
    );
    setDirty(true);
  };

  const addRow = () => {
    setSheets((prev) =>
      prev.map((sheet, index) =>
        index === activeSheet ? { ...sheet, rows: [...sheet.rows, []] } : sheet
      )
    );
    setDirty(true);
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/files/${file.id}/editor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast(data.error ?? "Could not save the file", "error");
        return;
      }
      toast("Saved");
      setDirty(false);
      onSaved?.();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  };

  return (
    <Modal open={Boolean(file)} onClose={close} title={file?.name ?? "File"} size="max-w-5xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
            {file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ""}
          </span>
          {payload?.kind === "sheet" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
              <FileSpreadsheet size={10} /> spreadsheet
            </span>
          )}
          {dirty && <span className="text-[10px] font-semibold text-amber-600">unsaved changes</span>}

          <span className="flex-1" />

          {file && (
            <a
              href={`/api/files/${file.id}/download`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-caption font-semibold text-[var(--muted)] transition hover:text-[var(--text)]"
            >
              <Download size={12} /> Download
            </a>
          )}
          {payload?.kind === "sheet" && payload.editable && (
            <Button disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>

        {loading ? (
          <p className="py-16 text-center text-meta text-[var(--muted)]">Opening…</p>
        ) : !payload ? (
          <p className="py-16 text-center text-meta text-[var(--muted)]">This file could not be opened.</p>
        ) : payload.kind === "image" ? (
          <img src={payload.url} alt={file?.name ?? "file"} className="mx-auto max-h-[65vh] rounded-lg object-contain" />
        ) : payload.kind === "pdf" ? (
          <iframe src={payload.url} title={file?.name ?? "PDF"} className="h-[65vh] w-full rounded-lg border border-[var(--border)]" />
        ) : payload.kind === "text" ? (
          <pre className="max-h-[65vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-caption whitespace-pre-wrap">
            {payload.text}
            {payload.truncated ? "\n\n…truncated for preview. Download for the whole file." : ""}
          </pre>
        ) : payload.kind === "sheet" ? (
          <div className="space-y-2">
            {sheets.length > 1 && (
              <div className="flex gap-1">
                {sheets.map((sheet, index) => (
                  <button
                    key={`${sheet.name}-${index}`}
                    onClick={() => setActiveSheet(index)}
                    className={`rounded-lg px-2 py-1 text-caption font-semibold transition ${
                      index === activeSheet
                        ? "bg-[#f0efff] text-accent dark:bg-[#302c4e] dark:text-[#c9c3ff]"
                        : "text-[var(--muted)] hover:bg-[var(--hover)]"
                    }`}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
            )}

            {payload.note && (
              <p className="text-[10px] text-[var(--muted)]">{payload.note}</p>
            )}

            <div className="max-h-[55vh] overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full border-collapse text-caption">
                <tbody>
                  {Array.from({ length: Math.max(rowCount, 1) }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                      <th className="sticky left-0 w-9 bg-[var(--surface-2)] px-1 text-right text-[10px] font-normal text-[var(--muted)]">
                        {rowIndex + 1}
                      </th>
                      {Array.from({ length: Math.max(columnCount, 1) }).map((__, columnIndex) => (
                        <td key={columnIndex} className="border border-[var(--border)] p-0">
                          <input
                            value={table.rows[rowIndex]?.[columnIndex] ?? ""}
                            onChange={(event) => editCell(rowIndex, columnIndex, event.target.value)}
                            aria-label={`Row ${rowIndex + 1} column ${columnIndex + 1}`}
                            className="w-full min-w-[110px] bg-transparent px-1.5 py-1 outline-none focus:bg-[#f0efff] dark:focus:bg-[#302c4e]"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {payload.editable && (
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1 text-caption font-semibold text-[var(--muted)] transition hover:text-accent"
              >
                <Plus size={12} /> Add row
              </button>
            )}
          </div>
        ) : (
          <div className="py-16 text-center">
            <Table2 size={20} className="mx-auto text-[var(--muted)]" />
            <p className="mt-2 text-meta font-semibold">No preview for this file type</p>
            <p className="mt-1 text-caption text-[var(--muted)]">
              {payload.reason ?? `${payload.mimeType || "This format"} cannot be shown inline yet. Download it instead.`}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
