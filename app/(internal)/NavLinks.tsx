"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };
type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

const navEntries: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard" },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Customers" },
      { href: "/properties", label: "Properties" },
      { href: "/equipment", label: "Equipment" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/leads", label: "Leads" },
      { href: "/documents", label: "Documents" },
      { href: "/price-book", label: "Price Book" },
      { href: "/mass-save", label: "MassSave" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/jobs", label: "Jobs" },
      { href: "/diagnostics", label: "Diagnostics" },
      { href: "/tasks", label: "Tasks" },
      { href: "/inventory", label: "Inventory" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/conversations", label: "Conversations" },
    ],
  },
];

// A logged-in "tech" role gets a reduced nav (their own jobs only); the
// shared Basic-Auth password and "owner"/"office" staff roles get everything.
const TECH_VISIBLE_PATHS = ["/dashboard", "/jobs"];

function pillClass(active: boolean) {
  return `shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
    active
      ? "bg-accent text-white shadow-[0_2px_8px_rgba(232,80,42,.35)]"
      : "text-g300 hover:text-white"
  }`;
}

function NavDropdown({ group, active }: { group: NavGroup; active: boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`${pillClass(active)} flex items-center gap-1`}
      >
        {group.label}
        <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 flex min-w-40 flex-col gap-0.5 rounded-lg border border-white/8 bg-navy p-1 shadow-lg"
        >
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-g300 transition-colors hover:bg-white/8 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavLinks({ role }: { role?: string | null }) {
  const pathname = usePathname();

  if (role === "tech") {
    return (
      <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/6 bg-white/4 p-1">
        {navEntries
          .filter((entry): entry is NavItem => !isGroup(entry) && TECH_VISIBLE_PATHS.includes(entry.href))
          .map((item) => (
            <Link key={item.href} href={item.href} className={pillClass(pathname.startsWith(item.href))}>
              {item.label}
            </Link>
          ))}
      </nav>
    );
  }

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/6 bg-white/4 p-1">
      {navEntries.map((entry) => {
        if (isGroup(entry)) {
          const groupActive = entry.items.some((item) => pathname.startsWith(item.href));
          return <NavDropdown key={entry.label} group={entry} active={groupActive} />;
        }
        return (
          <Link key={entry.href} href={entry.href} className={pillClass(pathname.startsWith(entry.href))}>
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
