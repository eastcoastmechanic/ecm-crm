import Link from "next/link";
import { Icon } from "../icons";
import { SERVICES } from "../services-data";

export const metadata = {
  title: "Our Services | East Coast Mechanical",
  description:
    "Heating, cooling, ductless mini-splits, ductwork, heat pumps, air quality, and maintenance services for the South Shore through the Cape and Islands.",
};

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-wide sm:text-4xl">Our Services</h1>
      <p className="mt-3 max-w-2xl text-sm text-g300 sm:text-base">
        Whatever's keeping your home from feeling right, we handle it. Pick a service below for more
        detail, or just book online and tell us what's going on.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <span className="mt-3 inline-block text-sm font-bold text-accent">Learn more →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
