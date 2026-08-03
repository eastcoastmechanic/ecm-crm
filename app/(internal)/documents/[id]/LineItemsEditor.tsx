"use client";

import { useState } from "react";
import { updateDocument } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, inputClass } from "../../ui";

type LineItem = {
  category: string;
  description: string;
  price_book_item_name: string | null;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
  notes: string | null;
};

let nextRowId = 1;

const numberInputClass = `${inputClass} w-24 text-right`;

export default function LineItemsEditor({
  documentId,
  status,
  items,
}: {
  documentId: string;
  status: string;
  items: LineItem[];
}) {
  const [rows, setRows] = useState(() =>
    items.map((item) => ({ rowId: nextRowId++, ...item }))
  );

  function updateRow(rowId: number, patch: Partial<LineItem>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        rowId: nextRowId++,
        category: "",
        description: "",
        price_book_item_name: null,
        qty: 1,
        unit: "EA",
        good: null,
        better: null,
        best: null,
        notes: null,
      },
    ]);
  }

  function removeRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  return (
    <form action={updateDocument} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={documentId} />
      <input type="hidden" name="item_count" value={rows.length} />

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Good</th>
              <th className="px-3 py-2">Better</th>
              <th className="px-3 py-2">Best</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, i) => (
              <tr key={item.rowId} className="border-b border-white/8 last:border-0">
                <td className="min-w-56 px-3 py-2 align-top">
                  <input
                    name={`description_${i}`}
                    value={item.description}
                    onChange={(e) => updateRow(item.rowId, { description: e.target.value })}
                    placeholder="Description"
                    className={`${inputClass} mb-1 w-full`}
                  />
                  <input
                    name={`category_${i}`}
                    value={item.category}
                    onChange={(e) => updateRow(item.rowId, { category: e.target.value })}
                    placeholder="Category"
                    className={`${inputClass} mb-1 w-full text-xs`}
                  />
                  <input
                    name={`notes_${i}`}
                    value={item.notes ?? ""}
                    onChange={(e) => updateRow(item.rowId, { notes: e.target.value })}
                    placeholder="Notes"
                    className={`${inputClass} w-full text-xs`}
                  />
                  <input
                    type="hidden"
                    name={`price_book_item_name_${i}`}
                    value={item.price_book_item_name ?? ""}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    name={`qty_${i}`}
                    value={item.qty}
                    onChange={(e) => updateRow(item.rowId, { qty: Number(e.target.value) })}
                    className={`${inputClass} w-16 text-right`}
                  />
                  <input
                    name={`unit_${i}`}
                    value={item.unit}
                    onChange={(e) => updateRow(item.rowId, { unit: e.target.value })}
                    className={`${inputClass} mt-1 w-16 text-xs`}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    step="0.01"
                    name={`good_${i}`}
                    defaultValue={item.good ?? ""}
                    className={numberInputClass}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    step="0.01"
                    name={`better_${i}`}
                    defaultValue={item.better ?? ""}
                    className={numberInputClass}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    step="0.01"
                    name={`best_${i}`}
                    defaultValue={item.best ?? ""}
                    className={numberInputClass}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(item.rowId)}
                    title="Remove line item"
                    className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={addRow} className={`${buttonSecondaryClass} w-fit`}>
        + Add Line Item
      </button>

      <div className="flex items-center gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-g300">
          Status
          <select name="status" defaultValue={status} className={inputClass}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save Changes
        </SubmitButton>
      </div>
    </form>
  );
}
