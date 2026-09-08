"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPANY_NAME } from "@/lib/brand";
import {
  STAFF_TABS,
  TECH_TABS,
  TECH_VISIBLE_PATHS,
  flattenNavItems,
  isGroup,
  isNavActive,
  navEntries,
} from "./nav-config";

function MoreLinks({
  role,
  pathname,
}: {
  role?: string | null;
  pathname: string;
}) {
  const moreItems =
    role === "tech"
      ? flattenNavItems().filter((item) => TECH_VISIBLE_PATHS.includes(item.href))
      : flattenNavItems();

  if (role === "tech") {
    return (
      <div className="grid gap-1">
        {moreItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-3 text-sm font-semibold ${
              isNavActive(item.href, pathname) ? "bg-accent text-white" : "bg-white/4 text-white"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <>
      {navEntries.map((entry) => {
        if (!isGroup(entry)) {
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={`rounded-lg px-3 py-3 text-sm font-semibold ${
                isNavActive(entry.href, pathname) ? "bg-accent text-white" : "bg-white/4 text-white"
              }`}
            >
              {entry.label}
            </Link>
          );
        }
        return (
          <div key={entry.label} className="grid gap-1">
            <div className="px-1 text-[11px] font-bold uppercase tracking-wide text-g300">
              {entry.label}
            </div>
            {entry.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-3 text-sm font-semibold ${
                  isNavActive(item.href, pathname) ? "bg-accent text-white" : "bg-white/4 text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

export default function AppTabs({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = role === "tech" ? TECH_TABS : STAFF_TABS;
  const moreActive =
    moreOpen ||
    (!tabs.some((tab) => isNavActive(tab.href, pathname)) && pathname !== "/account");

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-white/10 bg-navy-2 pb-[calc(5.5rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-y-0 md:left-52 md:right-auto md:bottom-auto md:h-full md:w-80 md:max-h-none md:rounded-none md:border-y-0 md:border-l md:border-r md:pb-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-white/8 bg-navy-2 px-5 py-3">
              <div className="font-display text-sm font-bold">More</div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-g300 hover:bg-white/8 hover:text-white"
              >
                Done
              </button>
            </div>
            <div className="grid gap-4 px-5 py-4">
              <MoreLinks role={role} pathname={pathname} />
              <Link
                href="/account"
                className={`rounded-lg px-3 py-3 text-sm font-semibold ${
                  pathname.startsWith("/account") ? "bg-accent text-white" : "bg-white/4 text-white"
                }`}
              >
                Account
              </Link>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-y-0 left-0 z-50 hidden w-52 flex-col border-r border-white/10 bg-navy/95 px-3 py-4 backdrop-blur-md md:flex">
        <div className="px-2 pb-4 font-display text-xs font-bold uppercase tracking-wide text-g300">
          {COMPANY_NAME}
        </div>
        <div className="grid gap-1">
          {tabs.map((tab) => {
            const active = !moreOpen && isNavActive(tab.href, pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${
                  active ? "bg-accent text-white" : "text-g300 hover:bg-white/6 hover:text-white"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className={`rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${
              moreActive ? "bg-accent text-white" : "text-g300 hover:bg-white/6 hover:text-white"
            }`}
          >
            More
          </button>
        </div>
      </nav>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-navy/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5">
          {tabs.map((tab) => {
            const active = !moreOpen && isNavActive(tab.href, pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex min-h-12 touch-manipulation flex-col items-center justify-center gap-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  active ? "text-accent" : "text-g300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className={`flex min-h-12 touch-manipulation flex-col items-center justify-center gap-0.5 text-[10px] font-bold uppercase tracking-wide ${
              moreActive ? "text-accent" : "text-g300"
            }`}
          >
            More
          </button>
        </div>
      </nav>
    </>
  );
}
