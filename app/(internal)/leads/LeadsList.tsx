"use client";

import { useMemo, useState } from "react";
import {
  updateLeadDraft,
  markContacted,
  dismissLead,
  sendLeadOutreach,
  addManualLead,
  setLeadStage,
  deleteLead,
} from "./actions";
import SubmitButton from "../SubmitButton";
import {
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
  buttonClass,
  buttonSecondaryClass,
  errorClass,
} from "../ui";

type Lead = {
  id: string;
  source: string;
  status: string;
  customer_id: string | null;
  equipment_id: string | null;
  phone_number: string | null;
  contact_name: string | null;
  contact_info: string | null;
  source_url: string | null;
  summary: string | null;
  channel: string | null;
  draft_message: string | null;
  auto_sendable: boolean;
  urgency_score: number;
  town: string | null;
  address: string | null;
  created_at: string;
  customers: { name: string | null; phone: string | null; email: string | null } | null;
};

const sourceLabel: Record<string, string> = {
  web_search: "Web Search",
  missed_contact: "Missed Contact",
  aging_equipment: "Aging Equipment",
  mls_import: "MLS Import",
  manual: "Manual",
};

const STATUS_OPTIONS = ["new", "contacted", "quoted", "won", "lost", "sent", "dismissed"];

const statusClass: Record<string, string> = {
  new: "bg-accent/20 text-accent",
  contacted: "bg-blue/40 text-white",
  quoted: "bg-gold/25 text-gold",
  won: "bg-green-l text-green",
  lost: "bg-white/8 text-g300",
  sent: "bg-green-l text-green",
  dismissed: "bg-white/8 text-g300",
};

function urgencyColor(score: number) {
  if (score >= 8) return "#ef4444";
  if (score >= 6) return "var(--accent)";
  if (score >= 4) return "var(--gold)";
  return "var(--blue)";
}

function leadName(lead: Lead) {
  return lead.contact_name ?? lead.customers?.name ?? "Unknown contact";
}

function leadPhone(lead: Lead) {
  return lead.phone_number ?? lead.customers?.phone ?? null;
}

function leadEmail(lead: Lead) {
  return lead.customers?.email ?? (lead.contact_info?.includes("@") ? lead.contact_info : null);
}

// Older/MLS-sourced leads only ever set contact_info (a freeform string —
// often a full address), not the dedicated address column added later.
// Fall back to it whenever it isn't obviously an email.
function leadAddress(lead: Lead) {
  if (lead.address) return lead.address;
  if (lead.contact_info && !lead.contact_info.includes("@")) return lead.contact_info;
  return null;
}

function AddLeadModal({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        action={async (formData) => {
          setError("");
          try {
            await addManualLead(formData);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save lead");
          }
        }}
        className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-white/8 bg-navy p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className={itemTitleClass}>Add lead</h3>
          <button type="button" onClick={onClose} className={subTextClass}>
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-g300">
          Name
          <input name="contact_name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Phone
          <input name="phone_number" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Email
          <input name="email" type="email" className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Town
            <input name="town" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Urgency (0–10)
            <input name="urgency_score" type="number" min={0} max={10} defaultValue={5} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Address
          <input name="address" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Reason / notes
          <textarea name="summary" rows={3} className={inputClass} />
        </label>

        {error && <p className={errorClass}>{error}</p>}

        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save lead
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

function LeadCard({
  lead,
  onStatusChange,
  onDelete,
}: {
  lead: Lead;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const isEmergency = lead.urgency_score >= 8;
  const phone = leadPhone(lead);
  const email = leadEmail(lead);
  const address = leadAddress(lead);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDelete() {
    if (!window.confirm(`Delete this lead (${leadName(lead)})? This cannot be undone.`)) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const result = await deleteLead(lead.id);
      if (result.error) {
        setDeleteError(result.error);
        setDeleting(false);
      } else {
        onDelete(lead.id);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete lead");
      setDeleting(false);
    }
  }

  const draftValue = drafts[lead.id] ?? lead.draft_message ?? "";

  async function persistDraft() {
    if (draftValue === (lead.draft_message ?? "")) return;
    setSaveError("");
    try {
      const fd = new FormData();
      fd.set("id", lead.id);
      fd.set("draft_message", draftValue);
      await updateLeadDraft(fd);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save draft");
    }
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draftValue);
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-4"
      style={{ borderColor: isEmergency ? "#ef4444" : "rgba(255,255,255,.08)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-1 min-w-56 gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: urgencyColor(lead.urgency_score) }}
          >
            {lead.urgency_score}
          </div>
          <div>
            <div className={itemTitleClass}>
              {leadName(lead)}
              <span className="ml-2 rounded bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                {sourceLabel[lead.source] ?? lead.source}
              </span>
            </div>
            <div className={itemSubClass}>
              {[address, lead.town && lead.town !== address ? lead.town : null].filter(Boolean).join(" · ")}
              {lead.created_at && ` · ${new Date(lead.created_at).toLocaleDateString()}`}
              {lead.source_url && (
                <>
                  {" · "}
                  <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="underline">
                    View source
                  </a>
                </>
              )}
            </div>
            {isEmergency && (
              <div className="mt-1.5 inline-block rounded-full bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-400">
                Emergency — call now
              </div>
            )}
            {lead.summary && <p className="mt-2 text-sm text-white">{lead.summary}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={lead.status}
            onChange={(e) => onStatusChange(lead.id, e.target.value)}
            className={`h-fit rounded-lg border-none px-2.5 py-1.5 text-[11px] font-semibold ${statusClass[lead.status] ?? "bg-white/8 text-g300"}`}
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
            title="Delete lead"
            className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            🗑️
          </button>
        </div>
      </div>
      {deleteError && <p className={errorClass}>{deleteError}</p>}

      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-1.5 rounded-lg bg-green px-3 py-1.5 text-xs font-semibold text-white">
            📞 {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-semibold text-white">
            ✉️ Email
          </a>
        )}
      </div>

      {(lead.draft_message !== null || lead.status === "new") && lead.source !== "manual" && (
        <>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Draft message
            <textarea
              value={draftValue}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [lead.id]: e.target.value }))}
              onBlur={persistDraft}
              rows={3}
              className={inputClass}
            />
          </label>
          {saveError && <p className={errorClass}>{saveError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copyDraft} className={buttonSecondaryClass}>
              {copiedId === lead.id ? "Copied!" : "Copy Draft"}
            </button>

            {lead.status === "new" && (
              <>
                <form action={markContacted}>
                  <input type="hidden" name="id" value={lead.id} />
                  <SubmitButton className={buttonSecondaryClass}>Mark Contacted</SubmitButton>
                </form>
                <form action={dismissLead}>
                  <input type="hidden" name="id" value={lead.id} />
                  <SubmitButton className={buttonSecondaryClass}>Dismiss</SubmitButton>
                </form>
                {lead.auto_sendable && (
                  <form
                    action={async () => {
                      const fd = new FormData();
                      fd.set("id", lead.id);
                      fd.set("draft_message", draftValue);
                      await sendLeadOutreach(fd);
                    }}
                  >
                    <SubmitButton className={buttonClass} pendingText="Sending…">
                      Send via {lead.channel === "sms" ? "Text" : "Email"}
                    </SubmitButton>
                  </form>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function LeadsList({ leads }: { leads: Lead[] }) {
  const [search, setSearch] = useState("");
  const [town, setTown] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const liveLeads = useMemo(() => leads.filter((l) => !deletedIds.has(l.id)), [leads, deletedIds]);

  const stats = useMemo(
    () => ({
      total: liveLeads.length,
      emergency: liveLeads.filter((l) => l.urgency_score >= 8).length,
      new: liveLeads.filter((l) => l.status === "new").length,
      contacted: liveLeads.filter((l) => l.status === "contacted").length,
      won: liveLeads.filter((l) => l.status === "won" || l.status === "sent").length,
    }),
    [liveLeads]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return liveLeads
      .map((l) => (localStatus[l.id] ? { ...l, status: localStatus[l.id] } : l))
      .filter((lead) => {
        if (statusFilter !== "all" && lead.status !== statusFilter) return false;
        if (town && !(lead.town ?? "").toLowerCase().includes(town.toLowerCase())) return false;
        if (!query) return true;
        return [lead.summary, leadName(lead), lead.contact_info, lead.address]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query));
      })
      .sort((a, b) => b.urgency_score - a.urgency_score);
  }, [liveLeads, search, town, statusFilter, localStatus]);

  function handleStatusChange(id: string, status: string) {
    setLocalStatus((prev) => ({ ...prev, [id]: status }));
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", status);
    setLeadStage(fd);
  }

  function handleDelete(id: string) {
    setDeletedIds((prev) => new Set(prev).add(id));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Emergency" value={stats.emergency} color="#ef4444" />
        <StatCard label="New" value={stats.new} color="var(--blue)" />
        <StatCard label="Contacted" value={stats.contacted} color="var(--gold)" />
        <StatCard label="Won" value={stats.won} color="var(--green)" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <input
            type="text"
            placeholder="Search name / notes…"
            aria-label="Search leads"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Filter by town"
            aria-label="Filter by town"
            value={town}
            onChange={(e) => setTown(e.target.value)}
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
          + Add lead
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && <p className={subTextClass}>No leads match.</p>}
        {filtered.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onStatusChange={handleStatusChange} onDelete={handleDelete} />
        ))}
      </div>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
