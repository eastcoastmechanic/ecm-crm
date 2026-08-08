import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import NavLinks from "./NavLinks";
import ChatWidget from "./ChatWidget";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staffRole = (await headers()).get("x-staff-role");

  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
          <div className="flex shrink-0 items-center gap-2.5">
            <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
            <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
              East Coast Mechanical
            </div>
          </div>
          <div className="hidden h-6 w-px bg-white/8 sm:block" />
          <NavLinks role={staffRole} />
          <Link
            href="/account"
            className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-g300 transition-colors hover:text-white"
          >
            Account
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <ChatWidget />
    </div>
  );
}
