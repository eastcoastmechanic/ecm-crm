"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonClass, buttonSecondaryClass, inputClass } from "../ui";

export type CatalogItem = {
  id: string;
  model: string;
  brand: string;
  sell: number;
  note: string | null;
  kind: string;
  kbtu: number | null;
  ports: number | null;
  series: string | null;
  search: string;
};

type CartLine = {
  id: string;
  model: string;
  description: string;
  qty: number;
  unitPrice: number;
  category: string;
};

const MA_TAX = 0.0625;
const LABOR_RATE = 125;

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function scoreItem(item: CatalogItem, tokens: string[]) {
  if (tokens.length === 0) return 1;
  let score = 0;
  for (const t of tokens) {
    if (item.model.toLowerCase().includes(t)) score += 5;
    else if (item.search.includes(t)) score += 2;
    else return 0;
  }
  return score;
}

function parsePackage(text: string): { zones: number; kbtu: number | null; multi: boolean } | null {
  const t = text.toLowerCase().replace(/heafs?|hedas|heads?/g, "heads");
  const qtyK = t.match(/(\d+)\s*[x×]?\s*(\d{1,2})\s*k/);
  if (qtyK) return { zones: parseInt(qtyK[1], 10), kbtu: parseInt(qtyK[2], 10), multi: true };
  const twoNine = t.match(/(two|2)\s*(9)\s*k?\s*heads?/);
  if (twoNine) return { zones: 2, kbtu: 9, multi: true };
  const zonesOnly = t.match(/(\d+)\s*(heads?|zones?|mini\s*splits?)/);
  if (zonesOnly) return { zones: parseInt(zonesOnly[1], 10), kbtu: null, multi: true };
  return null;
}

function buildPackage(items: CatalogItem[], zones: number, kbtu: number | null) {
  const headSize = kbtu ?? 9;
  const heads = items
    .filter((i) => i.kind === "indoor_head" && i.kbtu === headSize)
    .sort((a, b) => a.sell - b.sell);
  const head = heads[0];
  if (!head) return null;

  const needed = zones * headSize;
  const outdoors = items
    .filter((i) => i.kind === "outdoor_multi" && (i.ports ?? 0) >= zones)
    .filter((i) => (i.kbtu ?? 0) >= needed * 0.85)
    .sort((a, b) => {
      const portDiff = Math.abs((a.ports ?? 9) - zones) - Math.abs((b.ports ?? 9) - zones);
      if (portDiff !== 0) return portDiff;
      return a.sell - b.sell;
    });

  const bySeries: Record<string, CatalogItem> = {};
  for (const o of outdoors) {
    const s = o.series || "MXM";
    if (!bySeries[s]) bySeries[s] = o;
  }

  return { head, outdoors: Object.values(bySeries), zones, headSize };
}

export default function CatalogApp({ items }: { items: CatalogItem[] }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("all");
  const [kind, setKind] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [laborHours, setLaborHours] = useState(0);
  const [pkgText, setPkgText] = useState("");
  const [pkgMsg, setPkgMsg] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [jobAddress, setJobAddress] = useState("");
  const [jobNotes, setJobNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const brands = useMemo(() => Array.from(new Set(items.map((i) => i.brand))).sort(), [items]);

  const filtered = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
    return items
      .filter((i) => (brand === "all" ? true : i.brand === brand))
      .filter((i) => (kind === "all" ? true : i.kind === kind))
      .map((i) => ({ i, s: scoreItem(i, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i.sell - b.i.sell)
      .slice(0, 80)
      .map((x) => x.i);
  }, [items, q, brand, kind]);

  const equipmentSubtotal = useMemo(
    () => money(cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)),
    [cart]
  );
  const labor = money(laborHours * LABOR_RATE);
  const subtotal = money(equipmentSubtotal + labor);
  const tax = money(equipmentSubtotal * MA_TAX);
  const total = money(subtotal + tax);
  const deposit = money(total * 0.5);

  const addItem = useCallback((item: CatalogItem, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      if (existing) {
        return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + qty } : l));
      }
      return [
        ...prev,
        {
          id: item.id,
          model: item.model,
          description: item.note ? `${item.model} — ${item.note}` : item.model,
          qty,
          unitPrice: item.sell,
          category: item.kind.startsWith("indoor")
            ? "Indoor"
            : item.kind.startsWith("outdoor")
              ? "Outdoor"
              : item.brand,
        },
      ];
    });
    setShowCart(true);
  }, []);

  function setQty(id: string, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.id === id ? { ...l, qty: Math.max(0, qty) } : l)).filter((l) => l.qty > 0)
    );
  }

  function runPackage() {
    const parsed = parsePackage(pkgText);
    if (!parsed) {
      setPkgMsg('Try: two 9k heads · 2x12k multi · 3 mini splits');
      return;
    }
    const built = buildPackage(items, parsed.zones, parsed.kbtu);
    if (!built) {
      setPkgMsg("No matching heads/outdoor found for that combo.");
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      const add = (item: CatalogItem, qty: number, category: string) => {
        const existing = next.find((l) => l.id === item.id);
        if (existing) existing.qty += qty;
        else
          next.push({
            id: item.id,
            model: item.model,
            description: item.note ? `${item.model} — ${item.note}` : item.model,
            qty,
            unitPrice: item.sell,
            category,
          });
      };
      add(built.head, built.zones, "Indoor");
      const preferred =
        built.outdoors.find((o) => o.series === "MXT") ||
        built.outdoors.find((o) => o.series === "MXTH") ||
        built.outdoors[0];
      if (preferred) add(preferred, 1, "Outdoor");
      return next;
    });
    const alts = built.outdoors
      .map((o) => {
        const label =
          o.series === "MXT"
            ? "Cold climate (MXT)"
            : o.series === "MXTH"
              ? "Hyper heat (MXTH)"
              : "Standard (MXM)";
        return `${label}: ${o.model} ${formatMoney(o.sell)}`;
      })
      .join(" · ");
    setPkgMsg(`Added ${built.zones}× ${built.head.model} (${built.headSize}k) + outdoor. Options: ${alts}`);
    setShowCart(true);
  }

  async function finalize() {
    if (!customerName.trim()) {
      setStatus("Customer name required");
      return;
    }
    if (cart.length === 0) {
      setStatus("Cart is empty");
      return;
    }
    setBusy(true);
    setStatus(null);
    setResultUrl(null);
    try {
      const res = await fetch("/api/ingest/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          source: "catalog-app",
          customer: {
            name: customerName.trim(),
            email: customerEmail.trim() || undefined,
            phone: customerPhone.trim() || undefined,
          },
          property: jobAddress.trim() ? { address: jobAddress.trim() } : undefined,
          job: {
            createJob: true,
            notes: jobNotes.trim() || pkgText.trim() || undefined,
          },
          document: {
            type: "estimate",
            status: "draft",
            lineItems: cart.map((l) => ({
              description: l.description,
              model: l.model,
              qty: l.qty,
              unitPrice: l.unitPrice,
              category: l.category,
            })),
            laborHours: laborHours > 0 ? laborHours : undefined,
            laborRate: LABOR_RATE,
            subtotal,
            tax,
            total,
            depositPercent: 50,
            rawRequest: pkgText.trim() || jobNotes.trim() || undefined,
            notes: jobNotes.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(`Saved ${data.docNumber} · total ${formatMoney(data.total)}`);
      setResultUrl(data.documentUrl || null);
      setCart([]);
      setLaborHours(0);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ecm-catalog-cart");
      if (raw) {
        const parsed = JSON.parse(raw) as { cart: CartLine[]; laborHours: number };
        if (parsed.cart) setCart(parsed.cart);
        if (parsed.laborHours) setLaborHours(parsed.laborHours);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ecm-catalog-cart", JSON.stringify({ cart, laborHours }));
  }, [cart, laborHours]);

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-wide">Catalog</h1>
        <p className="text-sm text-g300">Lookup · package builder · cart → CRM estimate</p>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/3 p-3 flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-g300">Build package</label>
        <div className="flex gap-2">
          <input
            className={`${inputClass} flex-1`}
            placeholder='e.g. "two 9k heads" or "2x12k multi"'
            value={pkgText}
            onChange={(e) => setPkgText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runPackage()}
          />
          <button type="button" className={buttonClass} onClick={runPackage}>Build</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["two 9k heads", "2x12k multi", "3 mini splits", "2x15k"].map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-g300"
              onClick={() => setPkgText(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {pkgMsg && <p className="text-xs text-g300">{pkgMsg}</p>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Search model, 12k, wall, MXM…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="all">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All types</option>
          <option value="indoor_head">Indoor heads</option>
          <option value="outdoor_multi">Multi outdoor</option>
          <option value="outdoor_single">Single outdoor</option>
          <option value="equipment">Equipment</option>
          <option value="part">Parts</option>
        </select>
      </div>

      <p className="text-xs text-g500">{filtered.length} shown · {items.length} in book</p>

      <div className="grid gap-2">
        {filtered.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white truncate">{item.model}</div>
              <div className="text-xs text-g300 flex flex-wrap gap-x-2">
                <span>{item.brand}</span>
                {item.kbtu != null && <span>{item.kbtu}k</span>}
                {item.ports != null && <span>{item.ports}-port</span>}
                {item.series && <span>{item.series}</span>}
                {item.note && <span className="truncate max-w-[12rem]">{item.note}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-semibold text-white">{formatMoney(item.sell)}</div>
              <button
                type="button"
                className="mt-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold uppercase text-white"
                onClick={() => addItem(item)}
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-navy/95 backdrop-blur p-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" className={buttonSecondaryClass} onClick={() => setShowCart((s) => !s)}>
            Cart ({cart.reduce((n, l) => n + l.qty, 0)})
          </button>
          <div className="flex-1 text-sm">
            <span className="font-semibold text-white">{formatMoney(total)}</span>
            <span className="text-g300 text-xs ml-2">tax in · 50% dep {formatMoney(deposit)}</span>
          </div>
          <button type="button" className={buttonClass} disabled={cart.length === 0} onClick={() => setFinalizeOpen(true)}>
            Finalize
          </button>
        </div>
      </div>

      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowCart(false)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-navy p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-lg">Cart</h2>
              <button type="button" className="text-g300 text-sm" onClick={() => setShowCart(false)}>Close</button>
            </div>
            {cart.length === 0 && <p className="text-sm text-g300">Empty</p>}
            <div className="flex flex-col gap-2">
              {cart.map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded-lg border border-white/8 p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{l.model}</div>
                    <div className="text-xs text-g300">{formatMoney(l.unitPrice)} ea</div>
                  </div>
                  <input type="number" min={1} className={`${inputClass} w-16 py-1`} value={l.qty} onChange={(e) => setQty(l.id, parseInt(e.target.value || "1", 10))} />
                  <div className="w-20 text-right text-sm font-semibold">{formatMoney(l.unitPrice * l.qty)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-g300">Labor hours</label>
              <input type="number" min={0} step={0.5} className={`${inputClass} w-24 py-1`} value={laborHours} onChange={(e) => setLaborHours(parseFloat(e.target.value || "0"))} />
              <span className="text-xs text-g500">@ ${LABOR_RATE}/hr</span>
            </div>
            <div className="mt-3 space-y-1 text-sm border-t border-white/10 pt-3">
              <div className="flex justify-between"><span className="text-g300">Equipment</span><span>{formatMoney(equipmentSubtotal)}</span></div>
              <div className="flex justify-between"><span className="text-g300">Labor</span><span>{formatMoney(labor)}</span></div>
              <div className="flex justify-between"><span className="text-g300">MA tax 6.25%</span><span>{formatMoney(tax)}</span></div>
              <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatMoney(total)}</span></div>
              <div className="flex justify-between text-g300"><span>50% deposit</span><span>{formatMoney(deposit)}</span></div>
            </div>
            <button type="button" className={`${buttonClass} w-full mt-4`} onClick={() => { setShowCart(false); setFinalizeOpen(true); }}>Finalize → CRM</button>
          </div>
        </div>
      )}

      {finalizeOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={() => setFinalizeOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-white/10 bg-navy p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-bold text-lg mb-3">Save to CRM</h2>
            <div className="flex flex-col gap-2">
              <input className={inputClass} placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className={inputClass} placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              <input className={inputClass} placeholder="Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              <input className={inputClass} placeholder="Job address" value={jobAddress} onChange={(e) => setJobAddress(e.target.value)} />
              <textarea className={inputClass} placeholder="Job notes" rows={2} value={jobNotes} onChange={(e) => setJobNotes(e.target.value)} />
            </div>
            <p className="mt-2 text-sm text-g300">Total {formatMoney(total)} · will create draft estimate + job</p>
            {status && <p className={`mt-2 text-sm ${resultUrl ? "text-green-400" : "text-accent"}`}>{status}</p>}
            {resultUrl && (
              <a href={resultUrl} className="mt-2 block text-sm text-accent underline">Open estimate in CRM →</a>
            )}
            <div className="mt-4 flex gap-2">
              <button type="button" className={buttonSecondaryClass} onClick={() => setFinalizeOpen(false)}>Cancel</button>
              <button type="button" className={`${buttonClass} flex-1`} disabled={busy} onClick={finalize}>
                {busy ? "Saving…" : "Save to CRM"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
