import { supabase } from "@/lib/supabase";
import { headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function AnalyticsPage() {
  const [{ data: paidDocs }, { data: allDocs }, { data: leads }] = await Promise.all([
    supabase.from("documents").select("total, paid_at").eq("status", "paid").not("paid_at", "is", null),
    supabase.from("documents").select("type, total, status"),
    supabase.from("leads").select("source, status"),
  ]);

  const revenueByMonth = new Map<string, number>();
  for (const doc of paidDocs ?? []) {
    if (!doc.paid_at || !doc.total) continue;
    const key = monthKey(doc.paid_at);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + doc.total);
  }
  const sortedMonths = [...revenueByMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const ticketsByType = new Map<string, { count: number; total: number }>();
  for (const doc of allDocs ?? []) {
    if (!doc.total) continue;
    const entry = ticketsByType.get(doc.type) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += doc.total;
    ticketsByType.set(doc.type, entry);
  }

  const leadsBySource = new Map<string, { total: number; converted: number }>();
  for (const lead of leads ?? []) {
    const entry = leadsBySource.get(lead.source) ?? { total: 0, converted: 0 };
    entry.total++;
    if (lead.status === "sent" || lead.status === "contacted") entry.converted++;
    leadsBySource.set(lead.source, entry);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Analytics</h1>
        <p className={subTextClass}>Revenue, lead sources, and average ticket size.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Revenue by month</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {sortedMonths.length === 0 && <p className={subTextClass}>No paid documents yet.</p>}
          {sortedMonths.map(([key, total]) => (
            <div key={key} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>{monthLabel(key)}</div>
              <div className="font-mono text-sm text-white">{formatPrice(total)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Average ticket size by document type
        </h2>
        <div className="flex flex-col divide-y divide-white/8">
          {[...ticketsByType.entries()].map(([type, { count, total }]) => (
            <div key={type} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>
                {type} <span className={itemSubClass}>({count})</span>
              </div>
              <div className="font-mono text-sm text-white">{formatPrice(total / count)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Lead Radar source conversion
        </h2>
        <div className="flex flex-col divide-y divide-white/8">
          {leadsBySource.size === 0 && <p className={subTextClass}>No leads recorded yet.</p>}
          {[...leadsBySource.entries()].map(([source, { total, converted }]) => (
            <div key={source} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>{source.replace("_", " ")}</div>
              <div className={itemSubClass}>
                {converted} / {total} contacted ({total > 0 ? Math.round((converted / total) * 100) : 0}%)
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
