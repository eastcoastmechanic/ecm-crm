"use client";

import { useRef, useState } from "react";
import { downscaleImage } from "@/lib/downscale-image";
import { truckAddPhoto } from "./actions";

export type PhotoCounts = { arrival: number; during: number; completion: number };

const PHASES: { phase: keyof PhotoCounts; label: string }[] = [
  { phase: "arrival", label: "Arrival" },
  { phase: "during", label: "During" },
  { phase: "completion", label: "Done" },
];

const chip =
  "flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/8 bg-white/4 px-2 py-3 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8";

export default function PhotoButtons({ jobId, counts }: { jobId: string; counts: PhotoCounts }) {
  const [busy, setBusy] = useState<keyof PhotoCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(phase: keyof PhotoCounts, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(phase);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("job_id", jobId);
        formData.set("phase", phase);
        formData.append("photos", await downscaleImage(file));
        const result = await truckAddPhoto(formData);
        if (result.error) {
          setError(result.error);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      const input = inputs.current[phase];
      if (input) input.value = "";
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        {PHASES.map(({ phase, label }) => (
          <label key={phase} className={`${chip} ${busy ? "opacity-60" : ""}`}>
            <input
              ref={(el) => {
                inputs.current[phase] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={busy !== null}
              className="sr-only"
              onChange={(e) => upload(phase, e.target.files)}
            />
            {busy === phase ? "Uploading…" : `${label}${counts[phase] > 0 ? ` · ${counts[phase]}` : ""}`}
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-accent">{error}</p>}
    </div>
  );
}
