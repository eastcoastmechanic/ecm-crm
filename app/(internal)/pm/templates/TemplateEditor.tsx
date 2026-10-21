"use client";

import { useState } from "react";
import { savePmTemplate } from "../actions";
import type { PmReadingField, PmTemplateItem } from "@/lib/pm/types";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass } from "../../ui";

function blankItem(): PmTemplateItem {
  const key = `item_${Math.random().toString(36).slice(2, 8)}`;
  return { key, section: "General", label: "New item", readings: [] };
}

export default function TemplateEditor({
  templateId,
  name,
  initialItems,
}: {
  templateId: string;
  name: string;
  initialItems: PmTemplateItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(index: number, next: PmTemplateItem) {
    setItems((current) => current.map((item, i) => (i === index ? next : item)));
  }

  function move(index: number, direction: -1 | 1) {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [row] = copy.splice(index, 1);
      copy.splice(target, 0, row);
      return copy;
    });
  }

  function updateReading(index: number, readingIndex: number, field: PmReadingField) {
    const item = items[index];
    if (!item) return;
    const readings = item.readings.map((reading, i) => (i === readingIndex ? field : reading));
    update(index, { ...item, readings });
  }

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await savePmTemplate(templateId, items);
    setPending(false);
    if (result.error) setError(result.error);
    else setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">{name}</h2>
        <button type="button" onClick={() => void save()} disabled={pending} className={`${buttonClass} min-h-11`}>
          {pending ? "Saving…" : "Save template"}
        </button>
      </div>
      {error && <p className={errorClass}>{error}</p>}
      {saved && <p className="text-sm text-g300">Saved. New checklists use this list. Checklists already started keep their copy.</p>}
      {items.map((item, index) => (
        <article key={`${item.key}-${index}`} className="grid gap-2 rounded-xl border border-white/8 bg-white/3 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Section
              <input value={item.section} onChange={(e) => update(index, { ...item, section: e.target.value })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
              Item
              <input value={item.label} onChange={(e) => update(index, { ...item, label: e.target.value })} className={inputClass} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Help
            <input
              value={item.help ?? ""}
              onChange={(e) => update(index, { ...item, help: e.target.value })}
              className={inputClass}
            />
          </label>
          {item.readings.map((reading, readingIndex) => (
            <div key={reading.key} className="grid grid-cols-[1fr_6rem_auto] gap-2">
              <input
                aria-label={`${item.label} reading label`}
                value={reading.label}
                onChange={(e) => updateReading(index, readingIndex, { ...reading, label: e.target.value })}
                className={inputClass}
              />
              <input
                aria-label={`${item.label} unit`}
                value={reading.unit ?? ""}
                onChange={(e) => updateReading(index, readingIndex, { ...reading, unit: e.target.value || undefined })}
                className={inputClass}
                placeholder="unit"
              />
              <button
                type="button"
                className={buttonSecondaryClass}
                onClick={() => update(index, { ...item, readings: item.readings.filter((_, i) => i !== readingIndex) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSecondaryClass}
              onClick={() =>
                update(index, {
                  ...item,
                  readings: [
                    ...item.readings,
                    { key: `r_${Math.random().toString(36).slice(2, 7)}`, label: "Reading", input: "number" },
                  ],
                })
              }
            >
              Add reading
            </button>
            <button type="button" className={buttonSecondaryClass} onClick={() => move(index, -1)}>
              Up
            </button>
            <button type="button" className={buttonSecondaryClass} onClick={() => move(index, 1)}>
              Down
            </button>
            <button type="button" className={buttonSecondaryClass} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>
              Delete item
            </button>
          </div>
        </article>
      ))}
      <button type="button" className={`${buttonSecondaryClass} min-h-11 w-fit`} onClick={() => setItems((current) => [...current, blankItem()])}>
        Add item
      </button>
    </div>
  );
}
