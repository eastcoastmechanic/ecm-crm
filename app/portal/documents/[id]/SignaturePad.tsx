"use client";

import { useRef, useState } from "react";
import { approveEstimate } from "./actions";
import { buttonClass, subTextClass } from "../../../(internal)/ui";
import { TIER_LABEL, type Tier } from "@/lib/estimate-tier";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** One option the customer can pick on a Good/Better/Best estimate. */
export type TierOption = { tier: Tier; total: number; brand: string | null };

export default function SignaturePad({ documentId, options = [] }: { documentId: string; options?: TierOption[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [tier, setTier] = useState<Tier | null>(options.length === 1 ? options[0].tier : null);
  const needsTier = options.length > 0;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function handlePointerUp() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function submit() {
    if (!hasDrawn) return;
    if (needsTier && !tier) {
      setError("Pick Good, Better or Best before signing.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const dataUrl = canvasRef.current!.toDataURL("image/png");
      const formData = new FormData();
      formData.set("document_id", documentId);
      formData.set("signature_data", dataUrl);
      if (tier) formData.set("tier", tier);
      const result = await approveEstimate(formData);
      if (result?.error) {
        setError(result.error);
        setPending(false);
      }
    } catch (err) {
      // A redirect() call throws internally to signal navigation — let that
      // propagate; only report genuine errors to the customer.
      if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4 flex flex-col gap-3">
      {needsTier && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-white">Which option do you want?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {options.map((o) => (
              <label
                key={o.tier}
                className={`flex cursor-pointer flex-col rounded-lg border p-3 ${
                  tier === o.tier ? "border-blue bg-blue/20" : "border-white/8 bg-white/3"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="tier"
                    value={o.tier}
                    checked={tier === o.tier}
                    onChange={() => setTier(o.tier)}
                    disabled={pending}
                  />
                  <span className="text-sm font-bold text-white">{TIER_LABEL[o.tier]}</span>
                  <span className="ml-auto text-sm font-semibold text-white">{money(o.total)}</span>
                </span>
                {o.brand && <span className="mt-1 text-xs text-g300">{o.brand}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className={subTextClass}>
        {needsTier ? "Then sign below to approve the option you picked." : "Sign below to approve this estimate."}
      </p>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full max-w-md touch-none rounded-lg border border-white/8 bg-white/4"
      />
      {error && <p className="text-xs text-accent">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={clear} className={`${subTextClass} underline`}>
          Clear
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!hasDrawn || pending || (needsTier && !tier)}
          className={`${buttonClass} disabled:opacity-40`}
        >
          {pending ? "Submitting…" : "Approve & Sign"}
        </button>
      </div>
    </div>
  );
}
