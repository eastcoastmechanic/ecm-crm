"use client";

import { useMemo, useState } from "react";
import { createPurchaseOrder, updatePoStatus, deletePurchaseOrder } from "./actions";
import SubmitButton from "../SubmitButton";
import { inputClass, itemSubClass, itemTitleClass, subTextClass, buttonClass, errorClass } from "../ui";

export type JobOption = {
  id: string;
  scheduled_at: string | null;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
};

type LineItem = { description: string; qty: number; unit_cost: number };

export type PurchaseOrder = {
  id: string;
  job_id: string | null;
  vendor: string;
  po_number: string | null;
  status: string;
  line_items: LineItem[];
  total_cost: number | null;
  created_at: string;
  notes: string | null;
  jobs: JobOption | null;
};

const STATUS_OPTIONS = ["selected", "issued", "ordered", "received", "verified", "delivered"];

const statusClass: Record<string, string> = {
  selected: "bg-white/8 text-g300",
  issued: "bg-blue/40 text-white",
  ordered: "bg-gold/25 text-gold",
  received: "bg-accent/20 text-accent",
  verified: "bg-green-l text-green",
  delivered: "bg-green text-white",
};

function formatPrice(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function jobLabel(job: JobOption | null) {
  if (!job) return null;
  const who = [job.customers?.name, job.properties?.address].filter(Boolean).join(" — ");
  const date = job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : null;
  return [who, date].filter(Boolean).join(" · ") || null;
}

function AddPurchaseOrderModal({ jobOptions, onClose }: { jobOptions: JobOption[]; onClose: () => void }) {
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        action={async (formData) => {
          setError("");
          try {
            await createPurchaseOrder(formData);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save purchase order");
          }
        }}
        className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-white/8 bg-navy p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className={itemTitleClass}>New purchase order</h3>
          <button type="button" onClick={onClose} className={subTextClass}>
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-g300">
          Vendor
          <input name="vendor" required className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            PO number
            <input name="po_number" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Job (optional)
            <select name="job_id" defaultValue="" className={inputClass}>
              <option value="">— Stock order —</option>
              {jobOptions.map((job) => (
                <option key={job.id} value={job.id}>
                  {jobLabel(job) ?? job.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-g300">
          What&apos;s being ordered
          <input name="description" className={inputClass} placeholder="e.g. 3-ton Daikin condenser" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Qty
            <input name="qty" type="number" min={0} step="1" defaultValue={1} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Unit cost
            <input name="unit_cost" type="number" min={0} step="0.01" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Notes
          <textarea name="notes" rows={2} className={inputClass} />
        </label>

        {error && <p className={errorClass}>{error}</p>}

        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save purchase order
        </SubmitButton>
      </form>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-3 text-center">
      <div className="text-xl font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">{label}</div>
    </div>
  );
}

function PurchaseOrderCard({
  po,
  onStatusChange,
  onDelete,
}: {
  po: PurchaseOrder;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDelete() {
    if (!window.confirm(`Delete this purchase order (${po.vendor})? This cannot be undone.`)) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const result = await deletePurchaseOrder(po.id);
      if (result.error) {
        setDeleteError(result.error);
        setDeleting(false);
      } else {
        onDelete(po.id);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete purchase order");
      setDeleting(false);
    }
  }

  const item = po.line_items[0];
  const label = jobLabel(po.jobs);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={itemTitleClass}>
            {po.vendor}
            {po.po_number && (
              <span className="ml-2 rounded bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                {po.po_number}
              </span>
            )}
            {!po.jobs && (
              <span className="ml-2 rounded bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                Stock
              </span>
            )}
          </div>
          <div className={itemSubClass}>
            {[label, new Date(po.created_at).toLocaleDateString()].filter(Boolean).join(" · ")}
          </div>
          {item && (item.description || item.qty || item.unit_cost) && (
            <p className="mt-2 text-sm text-white">
              {item.description || "Item"}
              {item.qty ? ` × ${item.qty}` : ""}
              {po.total_cost ? ` — ${formatPrice(po.total_cost)}` : ""}
            </p>
          )}
          {po.notes && <p className="mt-1 text-sm text-g300">{po.notes}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={po.status}
            onChange={(e) => onStatusChange(po.id, e.target.value)}
            className={`h-fit rounded-lg border-none px-2.5 py-1.5 text-[11px] font-semibold ${statusClass[po.status] ?? "bg-white/8 text-g300"}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete purchase order"
            className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            🗑️
          </button>
        </div>
      </div>
      {deleteError && <p className={errorClass}>{deleteError}</p>}
    </section>
  );
}

export default function ProcurementList({
  purchaseOrders,
  jobOptions,
}: {
  purchaseOrders: PurchaseOrder[];
  jobOptions: JobOption[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const livePOs = useMemo(
    () => purchaseOrders.filter((po) => !deletedIds.has(po.id)),
    [purchaseOrders, deletedIds]
  );

  const withLocalStatus = useMemo(
    () => livePOs.map((po) => (localStatus[po.id] ? { ...po, status: localStatus[po.id] } : po)),
    [livePOs, localStatus]
  );

  const stats = useMemo(
    () => ({
      total: withLocalStatus.length,
      open: withLocalStatus.filter((po) => po.status !== "delivered").length,
      awaitingDelivery: withLocalStatus.filter((po) => po.status === "ordered" || po.status === "received")
        .length,
    }),
    [withLocalStatus]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return withLocalStatus
      .filter((po) => {
        if (statusFilter !== "all" && po.status !== statusFilter) return false;
        if (!query) return true;
        return [po.vendor, po.po_number, po.notes, po.jobs?.customers?.name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [withLocalStatus, search, statusFilter]);

  function handleStatusChange(id: string, status: string) {
    setLocalStatus((prev) => ({ ...prev, [id]: status }));
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", status);
    updatePoStatus(fd);
  }

  function handleDelete(id: string) {
    setDeletedIds((prev) => new Set(prev).add(id));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Open" value={stats.open} color="var(--gold)" />
        <StatCard label="Awaiting Delivery" value={stats.awaitingDelivery} color="var(--accent)" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Search vendor / PO # / job…"
            aria-label="Search purchase orders"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className={inputClass}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className={buttonClass}>
          + New purchase order
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && <p className={subTextClass}>No purchase orders match.</p>}
        {filtered.map((po) => (
          <PurchaseOrderCard key={po.id} po={po} onStatusChange={handleStatusChange} onDelete={handleDelete} />
        ))}
      </div>

      {showAdd && <AddPurchaseOrderModal jobOptions={jobOptions} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
