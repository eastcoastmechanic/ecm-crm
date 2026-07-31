"use client";

import { useRef, useState } from "react";
import { approveEstimate } from "./actions";
import { buttonClass, subTextClass } from "../../../(internal)/ui";

export default function SignaturePad({ documentId }: { documentId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
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
    setPending(true);
    setError(null);
    try {
      const dataUrl = canvasRef.current!.toDataURL("image/png");
      const formData = new FormData();
      formData.set("document_id", documentId);
      formData.set("signature_data", dataUrl);
      await approveEstimate(formData);
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
      <p className={subTextClass}>Sign below to approve this estimate.</p>
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
          disabled={!hasDrawn || pending}
          className={`${buttonClass} disabled:opacity-40`}
        >
          {pending ? "Submitting…" : "Approve & Sign"}
        </button>
      </div>
    </div>
  );
}
