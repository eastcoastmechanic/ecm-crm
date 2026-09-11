"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { pageTitle } from "./nav-config";

export default function AppHeader() {
  const pathname = usePathname();
  const title = pageTitle(pathname);

  return (
    <header className="relative sticky top-0 z-30 border-b border-white/6 bg-navy/95 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
      <div
        className="flex items-center gap-3 px-4 py-2 md:px-6"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <Image src="/logo-mark.png" alt="" width={32} height={28} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-bold tracking-wide">{title}</div>
        </div>
        <Link
          href="/account"
          aria-label="Account"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/6 text-xs font-bold text-g300 hover:bg-white/10 hover:text-white"
        >
          Me
        </Link>
      </div>
    </header>
  );
}
