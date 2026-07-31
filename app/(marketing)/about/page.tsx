import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "About Us | East Coast Mechanical",
  description:
    "East Coast Mechanical, founded 2024, brings a family-friendly, hometown approach to heating and cooling across the South Shore through the Cape and Islands.",
};

const TRUST_POINTS = [
  {
    title: "100% Guarantee",
    desc: "Every job is backed by our guarantee — if something isn't right, we make it right.",
  },
  {
    title: "Factory-Trained Technicians",
    desc: "Our team is trained directly on the equipment we install, not just generally certified.",
  },
  {
    title: "Family-Owned & Local",
    desc: "A family-friendly, hometown approach — not a call center reading from a script.",
  },
  {
    title: "24/7 Emergency Service",
    desc: "No heat or no AC doesn't wait for business hours, so neither do we for emergencies.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="grid items-center gap-10 sm:grid-cols-[auto_1fr]">
        <Image
          src="/site/logo-badge.png"
          alt="East Coast Mechanical, established 2024"
          width={180}
          height={180}
          className="mx-auto sm:mx-0"
        />
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-wide sm:text-4xl">
            About East Coast Mechanical
          </h1>
          <p className="mt-3 text-base text-g300">
            Founded in 2024, East Coast Mechanical brings a family-friendly, hometown approach to heating
            and cooling across the South Shore through the Cape and Islands.
          </p>
        </div>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {TRUST_POINTS.map((t) => (
          <div key={t.title} className="rounded-xl border border-white/8 bg-white/3 p-5">
            <div className="font-display text-base font-bold">{t.title}</div>
            <p className="mt-1 text-sm text-g300">{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 overflow-hidden rounded-xl border border-white/8 bg-black/20">
        <Image
          src="/site/work/mechanical-room-wide.jpg"
          alt="A fully finished mechanical room with a heat pump water heater, buffer tanks, and clearly labeled piping"
          width={1857}
          height={2476}
          className="mx-auto max-h-[520px] w-auto"
        />
      </div>

      <div className="mt-12 rounded-xl border border-white/8 bg-white/3 p-6">
        <h2 className="font-display text-lg font-bold">Certifications &amp; Brands</h2>
        <p className="mt-2 text-sm text-g300">
          We install and service equipment from Bosch, Lochinvar, Mitsubishi Electric, LG, Carrier, A.O.
          Smith, and Kohler, among others. Ask us about the specific licensing and certifications behind
          your project — we're happy to walk through it when we quote your job.
        </p>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Link
          href="/book"
          className="rounded-lg bg-gradient-to-br from-accent to-accent-2 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-all hover:-translate-y-0.5 hover:opacity-90"
        >
          Book Online
        </Link>
        <Link
          href="/contact"
          className="rounded-lg border border-white/8 bg-white/4 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition-all hover:-translate-y-0.5 hover:bg-white/8"
        >
          Contact Us
        </Link>
      </div>
    </div>
  );
}
