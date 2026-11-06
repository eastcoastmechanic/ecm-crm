"use client";

import { useActionState, useState } from "react";
import { updateDocument } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass } from "../../ui";
import { TIERS, TIER_LABEL, type Tier } from "@/lib/estimate-tier";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

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
  cost?: number | null;
};

let nextRowId = 1;

const numberInputClass = `${inputClass} w-24 text-right`;

export default function LineItemsEditor({
  documentId,
  status,
  items,
  pricingMode = "tiered",
  docType = "",
  selectedTier = null,
  canSeeProfit = false,
}: {
  documentId: string;
  status: string;
  items: LineItem[];
  pricingMode?: "tiered" | "flat";
  docType?: string;
  selectedTier?: Tier | null;
  canSeeProfit?: boolean;
}) {
  const isFlat = pricingMode === "flat";
  const [rows, setRows] = useState(() =>
    items.map((item) => ({ rowId: nextRowId++, ...item }))
  );
  const [state, formAction] = useActionState(updateDocument, null);
  // Controlled so a failed save doesn't reset them (React 19 resets forms after an action).
  const [statusValue, setStatusValue] = useState(status);
  const [tierValue, setTierValue] = useState<Tier | "">(selectedTier ?? "");
  // A phone approval: the office records which option the customer picked.
  const showTierPick = docType === "estimate" && !isFlat && statusValue === "approved";
  const tierTotal = (t: Tier) => rows.reduce((sum, r) => sum + (r[t] ?? 0) * (r.qty || 0), 0);

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
        cost: null,
      },
    ]);
  }

  function removeRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={documentId} />
      <input type="hidden" name="item_count" value={rows.length} />
      <input type="hidden" name="pricing_mode" value={pricingMode} />

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Qty</th>
              {isFlat ? (
                <th className="px-3 py-2">Price</th>
              ) : (
                <>
                  <th className="px-3 py-2">Good</th>
                  <th className="px-3 py-2">Better</th>
                  <th className="px-3 py-2">Best</th>
                </>
              )}
              {canSeeProfit && (
                <th className="px-3 py-2 text-gold" title="Internal only — never shown to the customer">
                  Cost
                </th>
              )}
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
                {isFlat ? (
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      value={item.good ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : Number(e.target.value);
                        updateRow(item.rowId, { good: value, better: value, best: value });
                      }}
                      className={numberInputClass}
                    />
                    <input type="hidden" name={`good_${i}`} value={item.good ?? ""} />
                    <input type="hidden" name={`better_${i}`} value={item.better ?? ""} />
                    <input type="hidden" name={`best_${i}`} value={item.best ?? ""} />
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        step="0.01"
                        name={`good_${i}`}
                        value={item.good ?? ""}
                        onChange={(e) => updateRow(item.rowId, { good: e.target.value === "" ? null : Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        step="0.01"
                        name={`better_${i}`}
                        value={item.better ?? ""}
                        onChange={(e) => updateRow(item.rowId, { better: e.target.value === "" ? null : Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        step="0.01"
                        name={`best_${i}`}
                        value={item.best ?? ""}
                        onChange={(e) => updateRow(item.rowId, { best: e.target.value === "" ? null : Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                  </>
                )}
                {canSeeProfit && (
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      name={`cost_${i}`}
                      value={item.cost ?? ""}
                      onChange={(e) => updateRow(item.rowId, { cost: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="Cost"
                      className={`${numberInputClass} border-gold/30`}
                    />
                  </td>
                )}
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

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-g300">
          Status
          <select
            name="status"
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value)}
            className={inputClass}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        {showTierPick && (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-g300">
            Customer picked
            <select
              name="selected_tier"
              value={tierValue}
              onChange={(e) => setTierValue(e.target.value as Tier | "")}
              className={inputClass}
            >
              <option value="">Choose option…</option>
              {TIERS.map((t) => (
                <option key={t} value={t} disabled={tierTotal(t) <= 0}>
                  {TIER_LABEL[t]} ({money(tierTotal(t))})
                </option>
              ))}
            </select>
          </label>
        )}
        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save Changes
        </SubmitButton>
      </div>
      {state?.error && <p className={errorClass}>{state.error}</p>}
      {state?.saved && <p className="text-sm text-green">Saved.</p>}
    </form>
  );
}
