import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import ChatWidget from "./ChatWidget";
import AppTabs from "./AppTabs";
import { COMPANY_NAME, COMPANY_SLOGAN } from "@/lib/brand";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staffRole = (await headers()).get("x-staff-role");

  return (
    <div className="app-shell min-h-dvh md:pl-52">
      <header className="relative sticky top-0 z-30 border-b border-white/6 bg-navy/95 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div
          className="flex items-center gap-x-4 px-4 py-2 md:px-6 md:py-2.5"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Image src="/logo-mark.png" alt="" width={40} height={34} className="shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold tracking-wide md:text-base">
                {COMPANY_NAME}
              </div>
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-g300 md:text-[11px]">
                {COMPANY_SLOGAN}
              </div>
            </div>
          </div>
          <Link
            href="/account"
            className="ml-auto shrink-0 rounded-md px-2 py-2 text-xs font-semibold text-g300 transition-colors hover:text-white"
          >
            Account
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-8 md:pb-8">
        {children}
      </main>
      <AppTabs role={staffRole} />
      <ChatWidget />
    </div>
  );
}
