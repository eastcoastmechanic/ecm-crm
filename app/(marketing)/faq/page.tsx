import Link from "next/link";

export const metadata = {
  title: "FAQ | East Coast Mechanical",
  description: "Answers to common questions about booking, scheduling, and service with East Coast Mechanical.",
};

const FAQS = [
  {
    q: "How do I book a service call?",
    a: "Book online in under a minute, or chat with our AI assistant any time — it can check real availability and file a request instantly. Every online request is reviewed and confirmed by our team, it's never auto-approved.",
  },
  {
    q: "What are your business hours?",
    a: "We're generally available Monday–Saturday, 7am–8pm, with 24/7 emergency service for no-heat and no-cooling situations. Online booking follows our standard weekday scheduling window — for a true emergency, call us directly rather than booking online.",
  },
  {
    q: "Is booking online the same as a confirmed appointment?",
    a: "Not quite — booking online (or through our AI assistant) creates a request. A real person from our team reviews and confirms it, usually quickly. We never claim an appointment is final until it's actually confirmed.",
  },
  {
    q: "What areas do you service?",
    a: "We serve the South Shore through the Cape and Islands. If you're not sure whether your address is in range, just ask through the booking form or chat and we'll follow up.",
  },
  {
    q: "Do you offer financing or rebates?",
    a: "Ask us when you book — we're happy to walk through what's available for your specific project.",
  },
  {
    q: "Do you offer a guarantee on your work?",
    a: "Yes — every job is backed by our 100% guarantee and handled by factory-trained technicians.",
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-wide sm:text-4xl">
        Frequently Asked Questions
      </h1>
      <p className="mt-3 text-sm text-g300">
        Don't see your question here?{" "}
        <Link href="/contact" className="font-bold text-accent hover:underline">
          Contact us
        </Link>{" "}
        or chat with our AI assistant.
      </p>

      <div className="mt-10 flex flex-col gap-4">
        {FAQS.map((item) => (
          <div key={item.q} className="rounded-xl border border-white/8 bg-white/3 p-5">
            <div className="font-display text-base font-bold">{item.q}</div>
            <p className="mt-2 text-sm text-g300">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
