import Link from "next/link";
import { headingClass, subTextClass, itemTitleClass, itemSubClass } from "../ui";

const tiles = [
  {
    href: "/diagnostics/new",
    title: "Service Report",
    description: "AI fault diagnosis from field readings — superheat/subcooling, suggested fix and parts.",
  },
  {
    href: "/tech-hub/install-report/new",
    title: "Install Report",
    description: "Lineset charge calc, nitrogen pressure test, vacuum/decay, startup checklist, sign-off.",
  },
  {
    href: "/tech-hub/pt-charts",
    title: "PT Charts",
    description: "Pressure/temperature saturation tables for R-410A, R-22, R-32, R-454B.",
  },
  {
    href: "/tech-hub/knowledge-base",
    title: "Knowledge Base",
    description: "Superheat/subcooling diagnostic guide and common fault scenarios.",
  },
  {
    href: "/diagnostics",
    title: "Past Service Reports",
    description: "Browse previously logged diagnostics.",
  },
  {
    href: "/tech-hub/install-report",
    title: "Past Install Reports",
    description: "Browse previously logged installs.",
  },
  {
    href: "/jobs",
    title: "Jobs",
    description: "Today's schedule and job list.",
  },
];

export default function TechHubPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Tech Hub</h1>
        <p className={subTextClass}>Field service tools — diagnostics, install sign-off, and reference charts.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col gap-1.5 rounded-xl border border-white/8 bg-white/3 p-4 transition-colors hover:bg-white/6"
          >
            <div className={itemTitleClass}>{tile.title}</div>
            <div className={itemSubClass}>{tile.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
