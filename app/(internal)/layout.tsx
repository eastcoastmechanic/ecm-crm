import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import NavLinks from "./NavLinks";
import ChatWidget from "./ChatWidget";
import AppTabs from "./AppTabs";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staffRole = (await headers()).get("x-staff-role");

  return (
    <div className="app-shell min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-white/6 bg-navy/95 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div
          className="mx-auto flex max-w-6xl items-center gap-x-5 px-4 py-2 md:px-6 md:py-2.5"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <Image src="/logo-mark.png" alt="ECM logo" width={40} height={34} className="shrink-0 md:h-[52px] md:w-[61px]" />
            <div className="hidden whitespace-nowrap font-display text-base font-bold tracking-wide sm:block">
              East Coast Mechanical
            </div>
            <div className="font-display text-sm font-bold tracking-wide sm:hidden">ECM</div>
          </div>
          <div className="hidden h-6 w-px bg-white/8 md:block" />
          <NavLinks role={staffRole} />
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
