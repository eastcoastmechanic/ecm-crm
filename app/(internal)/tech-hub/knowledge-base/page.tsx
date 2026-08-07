import { HVAC_DIAGNOSTIC_REFERENCE } from "@/lib/hvac-reference";
import { headingClass, subTextClass } from "../../ui";

export default function KnowledgeBasePage() {
  const sections = HVAC_DIAGNOSTIC_REFERENCE.split("\n\n");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Knowledge Base</h1>
        <p className={subTextClass}>ECM&apos;s field diagnostic guide — same reference used to ground AI diagnoses.</p>
      </div>

      <div className="flex flex-col gap-4">
        {sections.map((section, i) => {
          const [title, ...rest] = section.split("\n");
          return (
            <div key={i} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">{title}</h2>
              <pre className="whitespace-pre-wrap font-sans text-sm text-white">{rest.join("\n")}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
