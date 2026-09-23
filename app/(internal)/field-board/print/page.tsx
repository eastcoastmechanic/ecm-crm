import Link from "next/link";
import { getFieldSheetPayload, type FieldSheetLine } from "@/lib/field-sheet";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, subTextClass } from "../../ui";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

function Box({ title, items }: { title: string; items: FieldSheetLine[] }) {
  return (
    <section className="break-inside-avoid rounded-lg border border-black/15 bg-white p-3 text-black">
      <h2 className="mb-2 border-b border-black/20 pb-1 text-[11px] font-bold uppercase tracking-wide">{title}</h2>
      {items.length === 0 && <p className="text-xs text-black/50">None on the board.</p>}
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <div className="text-sm font-semibold">
              {item.label}
              {item.stamp ? <span className="ml-2 text-xs font-normal text-black/55">{item.stamp}</span> : null}
            </div>
            {item.detail ? <div className="text-xs text-black/60">{item.detail}</div> : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-3">
        <div className="border-b border-dotted border-black/30" />
        <div className="border-b border-dotted border-black/30" />
        <div className="border-b border-dotted border-black/30" />
      </div>
    </section>
  );
}

export default async function FieldBoardPrintPage() {
  const sheet = await getFieldSheetPayload();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className={headingClass}>Print sheet</h1>
          <p className={subTextClass}>Live CRM jobs, tasks, unpaid Square invoices, and field notes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/field-board" className={buttonSecondaryClass}>
            Back to board
          </Link>
          <a href="/field-board/print/pdf" className={buttonSecondaryClass}>
            Download PDF
          </a>
          <PrintButton className={buttonClass} />
        </div>
      </div>

      <article className="sheet-print mx-auto w-full max-w-[8.5in] bg-white p-5 text-black print:max-w-none print:p-0">
        <header className="mb-4 flex items-center justify-between border-b-4 border-[#e8502a] bg-[#0a1628] px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" width={56} height={48} className="h-12 w-14 object-contain" />
            <div>
              <div className="font-display text-lg font-bold tracking-wide">EAST COAST MECHANICAL</div>
              <div className="text-[10px] tracking-wide text-[#38b7e1]">BUILT WITH PRIDE · INSTALLED WITH PRECISION</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest">Daily field sheet</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold">{sheet.dateLabel}</div>
            <div className="text-xs text-white/70">Josh Crowley · CRM live</div>
          </div>
        </header>

        <section className="mb-3 rounded-lg border border-black/15 p-3">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide">Notes</h2>
          <ul className="grid gap-1 text-sm">
            {sheet.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <Box title="Active" items={sheet.active} />
          <Box title="Ongoing" items={sheet.ongoing} />
          <Box title="Task" items={sheet.tasks} />
          <Box title="To Bill" items={sheet.toBill} />
          <Box title="To Contact" items={sheet.toContact} />
          <Box title="Leftover" items={sheet.leftover} />
        </div>
        <p className={`${itemSubClass} mt-3 print:text-black/50`}>Source: ecm-crm jobs, tasks, field events, Square invoices due.</p>
      </article>
    </div>
  );
}
