"use client";

import { useMemo, useState } from "react";
import { updateLeadDraft, markContacted, dismissLead, sendLeadOutreach } from "./actions";
import SubmitButton from "../SubmitButton";
import { inputClass, itemSubClass, itemTitleClass, subTextClass, buttonClass, buttonSecondaryClass, errorClass } from "../ui";

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
  summary: string;
  channel: string;
  draft_message: string;
  auto_sendable: boolean;
  created_at: string;
  customers: { name: string | null; phone: string | null; email: string | null } | null;
};

const sourceLabel: Record<string, string> = {
  web_search: "Web Search",
  missed_contact: "Missed Contact",
  aging_equipment: "Aging Equipment",
  mls_import: "MLS Import",
};

const statusClass: Record<string, string> = {
  new: "bg-accent/20 text-accent",
  contacted: "bg-blue/40 text-white",
  sent: "bg-green-l text-green",
  dismissed: "bg-white/8 text-g300",
};

export default function LeadsList({ leads }: { leads: Lead[] }) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("new");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (sourceFilter !== "all" && lead.source !== sourceFilter) return false;
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (!query) return true;
      return [lead.summary, lead.contact_name, lead.customers?.name, lead.contact_info]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  }, [leads, search, sourceFilter, statusFilter]);

  function draftFor(lead: Lead) {
    return drafts[lead.id] ?? lead.draft_message;
  }

  async function persistDraft(lead: Lead) {
    const value = draftFor(lead);
    if (value === lead.draft_message) return;
    setSaveErrors((prev) => ({ ...prev, [lead.id]: "" }));
    try {
      const fd = new FormData();
      fd.set("id", lead.id);
      fd.set("draft_message", value);
      await updateLeadDraft(fd);
    } catch (err) {
      setSaveErrors((prev) => ({
        ...prev,
        [lead.id]: err instanceof Error ? err.message : "Failed to save draft",
      }));
    }
  }

  async function copyDraft(lead: Lead) {
    await navigator.clipboard.writeText(draftFor(lead));
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId((id) => (id === lead.id ? null : id)), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          type="text"
          placeholder="Search leads…"
          aria-label="Search leads"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          aria-label="Filter by source"
          className={inputClass}
        >
          <option value="all">All sources</option>
          {Object.entries(sourceLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={inputClass}
        >
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="sent">Sent</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && <p className={subTextClass}>No leads match.</p>}
        {filtered.map((lead) => (
          <section key={lead.id} className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className={itemTitleClass}>
                  {lead.contact_name ?? lead.customers?.name ?? "Unknown contact"}
                  <span className="ml-2 rounded bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                    {sourceLabel[lead.source] ?? lead.source}
                  </span>
                </div>
                <div className={itemSubClass}>
                  {lead.contact_info ?? lead.phone_number ?? lead.customers?.phone ?? lead.customers?.email ?? ""}
                  {" · "}
                  {new Date(lead.created_at).toLocaleDateString()}
                  {lead.source_url && (
                    <>
                      {" · "}
                      <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="underline">
                        View source
                      </a>
                    </>
                  )}
                </div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  statusClass[lead.status] ?? "bg-white/8 text-g300"
                }`}
              >
                {lead.status}
              </span>
            </div>

            <p className="text-sm text-white">{lead.summary}</p>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Draft message
              <textarea
                value={draftFor(lead)}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                onBlur={() => persistDraft(lead)}
                rows={3}
                className={inputClass}
              />
            </label>
            {saveErrors[lead.id] && <p className={errorClass}>{saveErrors[lead.id]}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => copyDraft(lead)} className={buttonSecondaryClass}>
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
                        fd.set("draft_message", draftFor(lead));
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
          </section>
        ))}
      </div>
    </div>
  );
}
