import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Icon } from "../../icons";
import { SERVICES, getServiceBySlug } from "../../services-data";

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return { title: "Service Not Found | East Coast Mechanical" };
  return {
    title: `${service.name} | East Coast Mechanical`,
    description: service.shortDesc,
  };
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    value
  );
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const orFilter = service.pricePatterns.map((p) => `name.ilike.%${p}%`).join(",");
  const { data: priceRows } = await supabase
    .from("price_book_items")
    .select("unit_price")
    .or(orFilter)
    .not("unit_price", "is", null)
    .order("unit_price", { ascending: true })
    .limit(1);

  const startingPrice = priceRows?.[0]?.unit_price ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/services" className="text-sm text-g300 hover:text-white">
        ← All services
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-accent-2/20 text-accent">
          <Icon path={service.icon} className="h-8 w-8" />
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-wide sm:text-4xl">{service.name}</h1>
      </div>

      {service.image && (
        <div className="mt-8 overflow-hidden rounded-xl border border-white/8 bg-black/20">
          <Image
            src={service.image.src}
            alt={service.image.alt}
            width={service.image.width}
            height={service.image.height}
            className="mx-auto max-h-[520px] w-auto"
          />
        </div>
      )}

      <p className="mt-6 text-base text-g300">{service.longDesc}</p>

      {startingPrice !== null && (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-white">
          Starting around <span className="font-bold text-accent">{formatPrice(startingPrice)}</span> —
          exact pricing depends on your system and home.{" "}
          <Link href="/book" className="font-bold underline">
            Get an exact quote
          </Link>
        </div>
      )}

      <h2 className="mt-10 font-display text-xl font-extrabold tracking-wide">Signs You Might Need This</h2>
      <ul className="mt-4 flex flex-col gap-2">
        {service.signs.map((sign) => (
          <li key={sign} className="flex gap-3 text-sm text-g300">
            <span className="text-accent">•</span>
            {sign}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap items-center gap-3">
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
          💬 Ask Our AI Assistant
        </button>
      </div>
    </div>
  );
}
