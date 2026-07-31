"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setInput("");
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
                {m.content}
              </div>
            ))}
            {pending && (
              <div className="self-start rounded-xl bg-white/6 px-3 py-2 text-sm text-g300">Working…</div>
            )}
          </div>

          <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-white/8 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command…"
              className="flex-1 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500 focus:border-accent"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
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
