import { COMPANY_EMAIL, COMPANY_NAME, COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import { PM_REPORT_TAGLINE } from "@/lib/pm/branding";
import type { PmReportModel, PmResult } from "@/lib/pm/types";

function resultLabel(result: PmResult | null) {
  if (result === "pass") return "Pass";
  if (result === "fail") return "Fail";
  if (result === "na") return "N/A";
  return "Open";
}

export default function PmReportArticle({ report }: { report: PmReportModel }) {
  const hasPhotos = report.sections.some((section) => section.items.some((item) => item.photos.some((photo) => photo.url)));

  return (
    <article className="mx-auto w-full max-w-[8.5in] bg-white p-5 text-black print:max-w-none print:p-0">
      <header className="border-b-4 border-[#0a1628] pb-3">
        <p className="font-display text-xl font-extrabold text-[#0a1628]">{COMPANY_NAME}</p>
        <p className="mt-1 text-[11px] font-bold tracking-wide text-[#0e7490]">{PM_REPORT_TAGLINE}</p>
        <p className="mt-1 text-xs text-[#334155]">
          {COMPANY_PHONE_DISPLAY} · {COMPANY_EMAIL}
        </p>
        <h1 className="mt-3 text-lg font-bold text-[#e8502a]">
          {report.doc_number ? `${report.doc_number} — ` : ""}
          {report.title}
        </h1>
        <p className="text-xs text-[#334155]">
          {report.date_label}
          {report.tech_name ? ` · Tech ${report.tech_name}` : ""}
          {` · ${report.audience_label}`}
        </p>
      </header>

      <section className="mt-4">
        <h2 className="text-base font-bold text-[#0a1628]">{report.customer_name}</h2>
        {report.property_address ? <p className="text-sm">{report.property_address}</p> : null}
        <p className="text-sm">
          {report.equipment_label}
          {report.equipment_serial ? ` · S/N ${report.equipment_serial}` : ""}
        </p>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Pass", report.summary.pass],
            ["Fail", report.summary.fail],
            ["N/A", report.summary.na],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded border border-black/10 p-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-black/50">{label}</div>
            <div className="text-lg font-bold">{value}</div>
          </div>
        ))}
      </section>

      {(report.failures.length > 0 || report.recommendations) && (
        <section className="mt-4 rounded border border-[#e8502a] bg-[#fdf1ee] p-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#e8502a]">Failures and recommendations</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {report.failures.map((item) => (
              <li key={item.key}>
                <span className="font-semibold">
                  {item.section} — {item.label}.
                </span>{" "}
                {item.readings
                  .map((reading) => `${reading.label} ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`)
                  .join(", ")}
                {item.notes ? ` ${item.notes}` : ""}
              </li>
            ))}
          </ul>
          {report.recommendations ? <p className="mt-2 text-sm">{report.recommendations}</p> : null}
        </section>
      )}

      {report.sections.map((section) => (
        <section key={section.name} className="mt-4">
          <h2 className="border-b border-black/15 pb-1 text-xs font-bold uppercase tracking-wide">{section.name}</h2>
          <div className="mt-2 grid gap-2">
            {section.items.map((item) => (
              <div key={item.key} className="break-inside-avoid text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{item.label}</span>
                  <span className={item.result === "fail" ? "font-bold text-[#e8502a]" : "text-black/70"}>
                    {resultLabel(item.result)}
                  </span>
                </div>
                {item.readings.length > 0 && (
                  <p className="text-xs text-black/70">
                    {item.readings
                      .map((reading) => `${reading.label}: ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`)
                      .join(" · ")}
                  </p>
                )}
                {item.notes ? <p className="text-xs text-black/70">{item.notes}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      {hasPhotos && (
        <section className="mt-4">
          <h2 className="text-xs font-bold uppercase tracking-wide">Photos</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {report.sections.flatMap((section) =>
              section.items.flatMap((item) =>
                item.photos.map((photo) =>
                  photo.url ? (
                    // Signed for this render only. next/image cannot allow every Supabase host.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={photo.url} src={photo.url} alt={item.label} className="h-28 w-36 rounded object-cover" />
                  ) : null
                )
              )
            )}
          </div>
        </section>
      )}
    </article>
  );
}
