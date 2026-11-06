"use client";

import { subTextClass } from "../ui";

// Pipeline board over the existing lead stages. "sent" (auto outreach went out)
// sits with Contacted, and "dismissed" (not a real lead) sits with Lost.
export const BOARD_COLUMNS = [
  { key: "new", label: "New", stages: ["new"], color: "var(--blue)" },
  { key: "contacted", label: "Contacted", stages: ["contacted", "sent"], color: "var(--gold)" },
  { key: "quoted", label: "Quoted", stages: ["quoted"], color: "var(--accent)" },
  { key: "won", label: "Won", stages: ["won"], color: "var(--green)" },
  { key: "lost", label: "Lost", stages: ["lost", "dismissed"], color: "var(--g300)" },
] as const;

const MOVE_TO = ["new", "contacted", "quoted", "won", "lost"];

export type BoardLead = {
  id: string;
  status: string;
  source: string;
  name: string;
  town: string | null;
  phone: string | null;
  summary: string | null;
  urgency: number;
  createdAt: string;
};

const sourceLabel: Record<string, string> = {
  web_search: "Web",
  missed_contact: "Missed call",
  aging_equipment: "Aging equipment",
  mls_import: "MLS",
  manual: "Manual",
};

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function BoardCard({
  lead,
  onMove,
  saving,
}: {
  lead: BoardLead;
  onMove: (id: string, status: string) => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium text-white">
          <span className="break-words">{lead.name}</span>
          {lead.urgency >= 8 && <span className="ml-1.5 text-[10px] font-bold uppercase text-red-400">urgent</span>}
        </div>
        <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
          {sourceLabel[lead.source] ?? lead.source}
        </span>
      </div>
      <div className="text-xs text-g300">
        {[lead.town, `added ${daysAgo(lead.createdAt)} ago`].filter(Boolean).join(" · ")}
      </div>
      {lead.summary && <p className="line-clamp-3 text-xs text-white/80">{lead.summary}</p>}
      <div className="mt-1 flex items-center justify-between gap-2">
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className="text-xs font-semibold text-green underline">
            {lead.phone}
          </a>
        ) : (
          <span className="text-xs text-g300">No phone</span>
        )}
        <select
          value={MOVE_TO.includes(lead.status) ? lead.status : ""}
          onChange={(e) => e.target.value && onMove(lead.id, e.target.value)}
          disabled={saving}
          aria-label={`Move ${lead.name} to stage`}
          className="rounded-md border-none bg-white/8 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {!MOVE_TO.includes(lead.status) && <option value="">{lead.status}</option>}
          {MOVE_TO.map((s) => (
            <option key={s} value={s}>
              {s === lead.status ? s : `Move to ${s}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Columns scroll sideways inside the board on a phone; the page itself never does. */
export default function LeadBoard({
  leads,
  onMove,
  savingId,
}: {
  leads: BoardLead[];
  onMove: (id: string, status: string) => void;
  savingId: string | null;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[56rem] grid-cols-5 gap-3">
        {BOARD_COLUMNS.map((col) => {
          const inCol = leads
            .filter((l) => (col.stages as readonly string[]).includes(l.status))
            .sort((a, b) => b.urgency - a.urgency || b.createdAt.localeCompare(a.createdAt));
          return (
            <div key={col.key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between border-b-2 pb-1.5" style={{ borderColor: col.color }}>
                <span className="text-xs font-bold uppercase tracking-wide text-white">{col.label}</span>
                <span className="text-xs font-semibold text-g300">{inCol.length}</span>
              </div>
              {inCol.length === 0 && <p className={`${subTextClass} text-xs`}>None</p>}
              {inCol.map((lead) => (
                <BoardCard key={lead.id} lead={lead} onMove={onMove} saving={savingId === lead.id} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
