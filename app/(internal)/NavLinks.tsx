"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  { href: "/tech-hub", label: "Tech Hub" },
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
      { href: "/catalog", label: "Catalog" },
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
      { href: "/procurement", label: "Procurement" },
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

const TECH_VISIBLE_PATHS = ["/dashboard", "/tech-hub", "/jobs", "/catalog"];

function pillClass(active: boolean) {
  return `shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
    active
      ? "bg-accent text-white shadow-[0_2px_8px_rgba(232,80,42,.35)]"
      : "text-g300 hover:text-white"
  }`;
}

function NavDropdown({ group, active }: { group: NavGroup; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((prev) => !prev);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`${pillClass(active)} flex items-center gap-1`}
      >
        {group.label}
        <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-50 flex min-w-40 flex-col gap-0.5 rounded-lg border border-white/8 bg-navy p-1 shadow-lg"
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
          </div>,
          document.body
        )}
    </>
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
