"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { generateDocument } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, inputClass, subTextClass } from "../../ui";
import CustomerPicker from "../../CustomerPicker";

type Customer = { id: string; name: string };
type Property = {
  id: string;
  address: string;
  customer_id: string | null;
  customers: { name: string | null }[] | null;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function subscribeNoop() {
  return () => {};
}

export default function NewDocumentForm({
  customers,
  properties,
}: {
  customers: Customer[];
  properties: Property[];
}) {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldKeepListeningRef = useRef(false);

  // SSR-safe feature check: browser APIs aren't present during server render,
  // so this must not run as a plain useState+useEffect (flags as
  // react-hooks/set-state-in-effect) — useSyncExternalStore's server snapshot
  // covers that case directly.
  const micSupported = useSyncExternalStore(
    subscribeNoop,
    () => getSpeechRecognitionCtor() !== null,
    () => false
  );

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText) {
        setDescription((prev) => (prev ? `${prev} ${finalText.trim()}` : finalText.trim()));
      }
    };
    recognition.onend = () => {
      // Chrome stops continuous recognition after a pause even though we
      // asked for continuous — restart transparently unless the user
      // explicitly stopped, so long dictation doesn't silently cut off.
      if (shouldKeepListeningRef.current) {
        recognition.start();
      } else {
        setListening(false);
      }
    };

    shouldKeepListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    shouldKeepListeningRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <form action={generateDocument} className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Document type
          <select name="type" required className={inputClass} defaultValue="estimate">
            <option value="estimate">Estimate</option>
            <option value="invoice">Invoice</option>
            <option value="proposal">Proposal</option>
          </select>
        </label>
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Property
          <select name="property_id" className={inputClass} defaultValue="">
            <option value="">No property (general estimate)</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.address}
                {property.customers?.[0]?.name ? ` — ${property.customers[0].name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          <div className="flex items-center justify-between">
            Job description
            {micSupported && (
              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                className={`${buttonSecondaryClass} !px-2 !py-1 ${listening ? "animate-pulse text-accent" : ""}`}
              >
                {listening ? "⏹ Stop" : "🎤 Talk to text"}
              </button>
            )}
          </div>
          <textarea
            name="raw_request"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the job in plain language — e.g. 'Replace 2-zone ductless system in the main house, customer wants heat pump water heater too, mention MassSave rebates.'"
            className={`${inputClass} min-h-32`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Photos &amp; plans (optional)
          <input
            type="file"
            name="photos"
            multiple
            accept="image/*,application/pdf"
            aria-label="Photos and plans"
            className={inputClass}
          />
          <span className="text-g500">Attach jobsite photos or plan PDFs — Claude will use them to help identify equipment, dimensions, and scope.</span>
        </label>
      </div>

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before generating a document.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Generating…">
        ⚡ Generate Document
      </SubmitButton>
    </form>
  );
}
