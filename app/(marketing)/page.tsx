import Image from "next/image";
import Link from "next/link";
import { Icon } from "./icons";
import { SERVICES } from "./services-data";
import Reveal from "./Reveal";
import Reviews from "./Reviews";

const PROCESS = ["Consultation", "Estimate", "Installation", "Inspection", "Guarantee"];

// width/height are each photo's real source dimensions, so the gallery can
// show every image at its true aspect ratio (object-contain) instead of
// cropping portrait phone photos to fit a fixed landscape box.
const RECENT_WORK = [
  {
    src: "/site/work/coastal-home-wide.jpg",
    alt: "Four central AC condensers and a Kohler standby generator installed at a coastal home",
    caption: "Whole-home comfort + backup power, South Shore",
    width: 1857,
    height: 1393,
  },
  {
    src: "/site/work/boiler-room.jpg",
    alt: "A Lochinvar boiler and indirect water heater installed with copper piping",
    caption: "Lochinvar boiler install",
    width: 1857,
    height: 1393,
  },
  {
    src: "/site/work/heat-pump-water-heaters.jpg",
    alt: "Two A.O. Smith heat pump water heaters installed in a mechanical room",
    caption: "Heat pump water heaters",
    width: 1857,
    height: 2476,
  },
  {
    src: "/site/work/hydronic-manifold.jpg",
    alt: "A multi-zone hydronic manifold system with copper and PEX piping",
    caption: "Multi-zone manifold work",
    width: 1857,
    height: 2476,
  },
  {
    src: "/site/work/lg-minisplits-new-construction.jpg",
    alt: "Two LG ductless mini-split condensers installed during new construction",
    caption: "Ductless mini-splits, new build",
    width: 1857,
    height: 2476,
  },
  {
    src: "/site/work/water-treatment-system.jpg",
    alt: "A whole-home water filtration and softening system",
    caption: "Whole-home water treatment",
    width: 1857,
    height: 1393,
  },
];

const BADGES = ["24/7 Emergency Service", "Factory-Trained Technicians", "100% Guarantee", "Family-Owned & Local"];

export default function MarketingHome() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(232,80,42,.18),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(245,166,35,.10),transparent_55%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-10 px-6 py-20 sm:flex-row sm:justify-between sm:py-28">
          <div className="flex flex-col items-start gap-6">
            <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent">
              ⚡ AI-Powered Booking &amp; Support
            </span>
            <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-tight tracking-wide sm:text-6xl">
              Home comfort, done right —
              <br />
              booked in seconds.
            </h1>
            <p className="max-w-xl text-base text-g300 sm:text-lg">
              Heating, cooling, ductless, and air quality service for the South Shore through the Cape and
              Islands. Check real appointment availability instantly and book online — no phone tag required.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/book"
                className="rounded-lg bg-gradient-to-br from-accent to-accent-2 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-all hover:-translate-y-0.5 hover:opacity-90"
              >
                Book Online
              </Link>
              <button
                type="button"
                data-open-chat
                className="rounded-lg border border-white/8 bg-white/4 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition-all hover:-translate-y-0.5 hover:bg-white/8"
              >
                💬 Chat with our AI Assistant
              </button>
            </div>
          </div>
          <div className="hidden shrink-0 rounded-2xl border border-accent/25 bg-white/3 p-1.5 shadow-2xl sm:block">
            <Image
              src="/site/work/coastal-home-wide.jpg"
              alt="A recent East Coast Mechanical install: central AC condensers and a backup generator at a South Shore home"
              width={1857}
              height={1393}
              priority
              className="h-auto w-72 rounded-xl lg:w-96"
            />
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="border-b border-white/6 bg-white/2">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-8 gap-y-3 px-6 py-5 text-xs font-bold uppercase tracking-wide text-g300">
          {BADGES.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="mx-auto w-full max-w-6xl px-6 py-16">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">Our Services</h2>
              <p className="mt-2 max-w-xl text-sm text-g300">
                Whatever's keeping your home from feeling right, we handle it.
              </p>
            </div>
            <Link href="/services" className="text-sm font-bold text-accent hover:underline">
              View all services →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group rounded-xl border border-white/8 bg-white/3 p-5 transition-all hover:-translate-y-1 hover:border-accent/40 hover:bg-white/6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent/20 to-accent-2/20 text-accent transition-transform group-hover:scale-110">
                  <Icon path={s.icon} />
                </div>
                <div className="mt-3 font-display text-base font-bold">{s.name}</div>
                <p className="mt-1 text-sm text-g300">{s.shortDesc}</p>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Recent Work */}
      <section className="border-y border-white/6 bg-white/2">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
              Recent Work
            </h2>
            <p className="mt-2 max-w-xl text-sm text-g300">
              Real installs from real jobs — not stock photos.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RECENT_WORK.map((photo) => (
                <div
                  key={photo.src}
                  className="group overflow-hidden rounded-xl border border-white/8 bg-white/3"
                >
                  <div className="flex h-64 items-center justify-center overflow-hidden bg-navy/60 sm:h-72">
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="px-4 py-3 text-sm font-bold text-white">{photo.caption}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* About */}
      <section className="border-y border-white/6 bg-white/2">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal className="grid items-center gap-10 sm:grid-cols-[auto_1fr]">
            <Image
              src="/site/logo-badge.png"
              alt="East Coast Mechanical, established 2024"
              width={180}
              height={180}
              className="mx-auto sm:mx-0"
            />
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
                About East Coast Mechanical
              </h2>
              <p className="mt-3 max-w-2xl text-sm text-g300 sm:text-base">
                Founded in 2024, East Coast Mechanical brings a family-friendly, hometown approach to
                heating and cooling across the South Shore through the Cape and Islands. Every job is
                backed by our 100% guarantee and handled by factory-trained technicians — from a small
                tune-up to a full system replacement.
              </p>
              <Link href="/about" className="mt-3 inline-block text-sm font-bold text-accent hover:underline">
                Learn more about us →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Process */}
      <section className="border-y border-white/6 bg-white/2">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">How It Works</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-5">
              {PROCESS.map((step, i) => (
                <div key={step} className="flex flex-col items-start gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 font-display text-sm font-extrabold text-white">
                    {i + 1}
                  </div>
                  <div className="text-sm font-bold text-white">{step}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <Reviews />

      {/* AI callout */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 via-transparent to-gold/10 p-8 sm:p-12">
            <span className="rounded-full border border-accent/30 bg-navy/60 px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent">
              Meet Your New Front Desk
            </span>
            <h2 className="mt-4 max-w-2xl font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
              Our AI assistant checks real availability and books real appointments — 24/7.
            </h2>
            <p className="mt-3 max-w-xl text-sm text-g300 sm:text-base">
              No hold music, no waiting for a callback. Ask about our services, get an instant answer on
              open time slots, and file a booking request any time, day or night. A real person always
              confirms before it&apos;s final.
            </p>
            <button
              type="button"
              data-open-chat
              className="mt-6 rounded-lg bg-gradient-to-br from-accent to-accent-2 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-all hover:-translate-y-0.5 hover:opacity-90"
            >
              💬 Start a Chat
            </button>
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="border-t border-white/6 bg-white/2">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal className="flex flex-col items-center gap-4 text-center">
            <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
              Ready to get comfortable?
            </h2>
            <p className="max-w-md text-sm text-g300">
              Book online in under a minute, or give us a call — we&apos;re here Mon–Sat, 7am–8pm, with
              24/7 emergency service.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/book"
                className="rounded-lg bg-gradient-to-br from-accent to-accent-2 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-all hover:-translate-y-0.5 hover:opacity-90"
              >
                Book Online
              </Link>
              <a
                href="tel:+17743436369"
                className="rounded-lg border border-white/8 bg-white/4 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition-all hover:-translate-y-0.5 hover:bg-white/8"
              >
                Call (774) 343-6369
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
