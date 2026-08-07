"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Attachment = { name: string; mediaType: string; base64: string };
type Message = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve({ name: file.name, mediaType: file.type || "application/octet-stream", base64 });
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

type SpeechRecognitionResultLike = { 0: { transcript: string } };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachError, setAttachError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const micSupported = useSyncExternalStore(
    subscribeNoop,
    () => getSpeechRecognitionCtor() !== null,
    () => false
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function sendText(text: string) {
    if ((!text.trim() && !attachment) || pending) return;

    const userMessage: Message = { role: "user", content: text.trim(), attachments: attachment ? [attachment] : undefined };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setAttachment(null);
    setPending(true);

    try {
      const res = await fetch("/api/internal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      const reply = res.ok ? data.reply : data.error || "Something went wrong.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong." }]);
    } finally {
      setPending(false);
    }
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    sendText(input);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachError("");
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError("That file's too large (32MB max, ~100 pages for a PDF).");
      return;
    }
    try {
      setAttachment(await readFileAsAttachment(file));
    } catch {
      setAttachError("Could not read that file.");
    }
  }

  function startVoiceCommand() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || listening) return;

    // Not continuous: one spoken command, then auto-stop and auto-send —
    // "just talk to it" shouldn't need a manual button press afterward.
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(" ")
        .trim();
      if (transcript) sendText(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    setOpen(true);
    setListening(true);
    recognition.start();
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-navy-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/8 bg-gradient-to-r from-accent/20 to-transparent px-4 py-3">
            <div>
              <div className="font-display text-sm font-bold">CRM Assistant</div>
              <div className="text-[11px] text-g300">Add customers, estimates, invoices, tasks</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-md px-2 py-1 text-g300 hover:bg-white/8 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {messages.length === 0 && (
              <p className="text-sm text-g300">
                Try: &quot;Add a customer named Jane Doe, phone 555-1234&quot; or &quot;Make an estimate
                for Jane Doe — replacing a leaking water heater&quot;.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "self-end bg-gradient-to-br from-accent to-accent-2 text-white"
                    : "self-start bg-white/6 text-white"
                }`}
              >
                {m.attachments?.map((a) => (
                  <div key={a.name} className="mb-1 text-xs opacity-80">
                    📎 {a.name}
                  </div>
                ))}
                {m.content}
              </div>
            ))}
            {listening && (
              <div className="self-end rounded-xl bg-accent/20 px-3 py-2 text-sm text-white">
                🎤 Listening…
              </div>
            )}
            {pending && (
              <div className="self-start rounded-xl bg-white/6 px-3 py-2 text-sm text-g300">Working…</div>
            )}
          </div>

          <div className="border-t border-white/8 px-3 pt-2">
            {attachment && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-white/6 px-2.5 py-1.5 text-xs text-g300">
                <span className="truncate">📎 {attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment" className="shrink-0 text-g300 hover:text-white">
                  ✕
                </button>
              </div>
            )}
            {attachError && <div className="mb-2 text-xs text-accent">{attachError}</div>}
          </div>
          <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-white/8 p-3 pt-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              aria-label="Attach a plan PDF or photo"
              title="Attach a plan PDF or photo"
              className="shrink-0 rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-sm text-g300 transition-colors hover:bg-white/8 disabled:opacity-50"
            >
              📎
            </button>
            {micSupported && (
              <button
                type="button"
                onClick={startVoiceCommand}
                disabled={listening || pending}
                aria-label="Speak a command"
                className={`shrink-0 rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-sm transition-colors hover:bg-white/8 disabled:opacity-50 ${
                  listening ? "animate-pulse text-accent" : "text-g300"
                }`}
              >
                🎤
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command…"
              className="flex-1 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500 focus:border-accent"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={pending || (!input.trim() && !attachment)}
              className="rounded-lg bg-gradient-to-br from-accent to-accent-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-gradient-to-br from-accent to-accent-2 px-5 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(232,80,42,.4)] transition-transform hover:scale-105"
      >
        {open ? "Close" : "💬 Assistant"}
      </button>
    </div>
  );
}
