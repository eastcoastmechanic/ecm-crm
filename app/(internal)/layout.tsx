import Image from "next/image";
import NavLinks from "./NavLinks";

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
          <div className="flex shrink-0 items-center gap-2.5">
            <Image src="/logo.png" alt="ECM logo" width={52} height={52} className="shrink-0" />
            <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
              East Coast Mechanical
            </div>
          </div>
          <div className="hidden h-6 w-px bg-white/8 sm:block" />
          <NavLinks />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
