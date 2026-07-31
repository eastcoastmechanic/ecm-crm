"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/properties", label: "Properties" },
  { href: "/equipment", label: "Equipment" },
  { href: "/price-book", label: "Price Book" },
  { href: "/documents", label: "Documents" },
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/jobs", label: "Jobs" },
  { href: "/leads", label: "Leads" },
  { href: "/tasks", label: "Tasks" },
  { href: "/inventory", label: "Inventory" },
  { href: "/analytics", label: "Analytics" },
  { href: "/mass-save", label: "MassSave" },
  { href: "/conversations", label: "Conversations" },
];

// A logged-in "tech" role gets a reduced nav (their own jobs only); the
// shared Basic-Auth password and "owner"/"office" staff roles get everything.
const TECH_VISIBLE_PATHS = ["/dashboard", "/jobs"];

export default function NavLinks({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const items =
    role === "tech" ? navItems.filter((item) => TECH_VISIBLE_PATHS.includes(item.href)) : navItems;

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/6 bg-white/4 p-1">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? "bg-accent text-white shadow-[0_2px_8px_rgba(232,80,42,.35)]"
                : "text-g300 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
