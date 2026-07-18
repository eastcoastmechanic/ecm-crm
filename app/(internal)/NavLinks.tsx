"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/customers", label: "Customers" },
  { href: "/properties", label: "Properties" },
  { href: "/equipment", label: "Equipment" },
  { href: "/price-book", label: "Price Book" },
  { href: "/documents", label: "Documents" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 rounded-lg border border-white/6 bg-white/4 p-1">
      {navItems.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
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
