"use client";

import { useState } from "react";
import { recordPartsUsed } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, inputClass } from "../../ui";

type PriceBookOption = { id: string; name: string; category: string | null; unit_price: number | null };
type Row = { name: string; qty: number; unitPrice: number | null };

let nextRowId = 1;

export default function PartsUsedForm({
  diagnosticId,
  priceBookOptions,
  initialRows,
}: {
  diagnosticId: string;
  priceBookOptions: PriceBookOption[];
  initialRows: Row[];
}) {
  const [rows, setRows] = useState(() =>
    (initialRows.length ? initialRows : [{ name: "", qty: 1, unitPrice: null }]).map((r) => ({
      rowId: nextRowId++,
      ...r,
    }))
  );

  function updateRow(rowId: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function handleNameChange(rowId: number, name: string) {
    const match = priceBookOptions.find((p) => p.name === name);
    updateRow(rowId, { name, unitPrice: match?.unit_price ?? null });
  }

  function addRow() {
    setRows((prev) => [...prev, { rowId: nextRowId++, name: "", qty: 1, unitPrice: null }]);
  }

  function removeRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  return (
    <form action={recordPartsUsed} className="flex flex-col gap-3">
      <input type="hidden" name="diagnostic_id" value={diagnosticId} />
      <input type="hidden" name="item_count" value={rows.length} />

      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={row.rowId} className="flex items-center gap-2">
            <select
              name={`name_${i}`}
              value={row.name}
              onChange={(e) => handleNameChange(row.rowId, e.target.value)}
              className={`${inputClass} flex-1`}
            >
              <option value="">Select a part…</option>
              {priceBookOptions.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.category ? `${item.category} — ` : ""}
                  {item.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="1"
              min="0"
              name={`qty_${i}`}
              value={row.qty}
              onChange={(e) => updateRow(row.rowId, { qty: Number(e.target.value) })}
              aria-label="Quantity"
              className={`${inputClass} w-20 text-right`}
            />
            <input type="hidden" name={`unit_price_${i}`} value={row.unitPrice ?? ""} />
            <span className="w-20 text-right text-xs text-g300">
              {row.unitPrice !== null ? `$${row.unitPrice.toFixed(2)}` : "—"}
            </span>
            <button
              type="button"
              onClick={() => removeRow(row.rowId)}
              title="Remove"
              className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={addRow} className={`${buttonSecondaryClass} w-fit`}>
          + Add Part
        </button>
        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save Parts Used
        </SubmitButton>
      </div>
    </form>
  );
}
