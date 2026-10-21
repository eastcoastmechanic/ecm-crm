"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filePmReport, savePmChecklist, uploadChecklistPhoto } from "../actions";
import { downscaleImage } from "@/lib/downscale-image";
import { applyReadingChange } from "@/lib/pm/report";
import type { PmChecklistItem, PmResult } from "@/lib/pm/types";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass } from "../../ui";

type ItemState = Omit<PmChecklistItem, "photos"> & {
  photos: { path: string; url?: string | null; caption?: string | null }[];
};

const RESULTS: { value: PmResult; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "na", label: "N/A" },
];

function resultClass(value: PmResult, selected: boolean) {
  if (!selected) return "border-white/10 bg-white/5 text-white";
  if (value === "pass") return "border-green bg-green text-white";
  if (value === "fail") return "border-accent bg-accent text-white";
  return "border-white/20 bg-white/15 text-white";
}

export default function ChecklistForm({
  checklistId,
  techName,
  recommendations,
  items,
  reportHref,
  filed,
}: {
  checklistId: string;
  techName: string;
  recommendations: string;
  items: ItemState[];
  reportHref: string | null;
  filed: boolean;
}) {
  const [tech, setTech] = useState(techName);
  const [notes, setNotes] = useState(recommendations);
  const [rows, setRows] = useState(items);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(filed ? "Report filed. You can still correct an item and file it again." : null);
  const [pending, setPending] = useState<"save" | "file" | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const answered = useMemo(() => rows.filter((row) => row.result).length, [rows]);

  function payload() {
    return {
      tech_name: tech,
      recommendations: notes,
      items: rows.map((row) => ({
        item_key: row.item_key,
        result: row.result,
        notes: row.notes,
        readings: row.readings,
      })),
    };
  }

  function patch(itemKey: string, update: (row: ItemState) => ItemState) {
    setRows((current) => current.map((row) => (row.item_key === itemKey ? update(row) : row)));
  }

  async function save() {
    setPending("save");
    setError(null);
    const result = await savePmChecklist(checklistId, payload());
    setPending(null);
    if (result.error) setError(result.error);
    else setMessage("Saved.");
  }

  async function fileReport() {
    setPending("file");
    setError(null);
    const result = await filePmReport(checklistId, payload());
    setPending(null);
    if (result?.error) setError(result.error);
  }

  async function onPhoto(itemKey: string, file: File | undefined) {
    if (!file) return;
    setUploading(itemKey);
    setError(null);
    try {
      const resized = await downscaleImage(file);
      const body = new FormData();
      body.set("photo", resized);
      const result = await uploadChecklistPhoto(checklistId, itemKey, body);
      if (result.error || !result.path) {
        setError(result.error ?? "Could not upload the photo");
      } else {
        patch(itemKey, (row) => ({
          ...row,
          photos: [...row.photos, { path: result.path!, url: result.url ?? null }],
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the photo");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Technician
          <input value={tech} onChange={(e) => setTech(e.target.value)} className={inputClass} autoComplete="name" />
        </label>
        <div className="flex items-end text-sm text-g300">
          {answered} of {rows.length} answered
          {reportHref ? (
            <Link href={reportHref} className="ml-3 underline">
              View report
            </Link>
          ) : null}
        </div>
      </div>

      {rows.map((row, index) => {
        const showSection = index === 0 || rows[index - 1]?.section !== row.section;
        return (
          <div key={row.item_key}>
            {showSection && (
              <h2 className="mb-2 mt-3 text-xs font-bold uppercase tracking-wide text-g300">{row.section}</h2>
            )}
            <article className="rounded-xl border border-white/8 bg-white/3 p-3">
              <div className="text-sm font-semibold text-white">{row.label}</div>
              {row.help ? <p className="mt-1 text-xs text-g300">{row.help}</p> : null}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {RESULTS.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={row.result === choice.value}
                    onClick={() => patch(row.item_key, (current) => ({ ...current, result: choice.value }))}
                    className={`min-h-11 rounded-lg border text-sm font-bold ${resultClass(choice.value, row.result === choice.value)}`}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              {row.reading_fields.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {row.reading_fields.map((field) => (
                    <label key={field.key} className="flex flex-col gap-1 text-xs text-g300">
                      {field.label}
                      {field.unit ? ` (${field.unit})` : ""}
                      <input
                        inputMode={field.input === "number" ? "decimal" : "text"}
                        value={row.readings[field.key] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          patch(row.item_key, (current) => ({
                            ...current,
                            readings: applyReadingChange(current.item_key, current.readings, field.key, value),
                          }));
                        }}
                        className={inputClass}
                      />
                    </label>
                  ))}
                </div>
              )}
              <label className="mt-3 flex flex-col gap-1 text-xs text-g300">
                Notes
                <textarea
                  value={row.notes ?? ""}
                  onChange={(e) => patch(row.item_key, (current) => ({ ...current, notes: e.target.value }))}
                  rows={2}
                  className={inputClass}
                />
              </label>
              {row.photos.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {row.photos.map((photo) =>
                    photo.url ? (
                      // Signed URLs are minted per request; next/image would need every host configured.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={photo.path}
                        src={photo.url}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div key={photo.path} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[10px] text-g300">
                        Photo
                      </div>
                    )
                  )}
                </div>
              )}
              <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-bold uppercase tracking-wide text-white">
                {uploading === row.item_key ? "Uploading…" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={uploading === row.item_key}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void onPhoto(row.item_key, file);
                  }}
                />
              </label>
            </article>
          </div>
        );
      })}

      <label className="mt-2 flex flex-col gap-1 text-xs text-g300">
        Recommendations
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
      </label>

      {error && <p className={errorClass}>{error}</p>}
      {message && !error && <p className="text-sm text-g300">{message}</p>}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex gap-2 rounded-xl border border-white/10 bg-navy/95 p-3 md:bottom-4">
        <button type="button" onClick={() => void save()} disabled={pending !== null} className={`${buttonSecondaryClass} min-h-11 flex-1`}>
          {pending === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => void fileReport()} disabled={pending !== null} className={`${buttonClass} min-h-11 flex-1`}>
          {pending === "file" ? "Filing…" : filed ? "Update report" : "File report"}
        </button>
      </div>
    </div>
  );
}
