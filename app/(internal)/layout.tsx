import NavLinks from "./NavLinks";

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="relative h-14 border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex h-full max-w-6xl items-center gap-5 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-gold font-display text-[11px] font-extrabold tracking-wide">
              ECM
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-extrabold tracking-wide">
                ECM Platform
              </div>
              <div className="font-mono text-[9px] tracking-widest text-g300 uppercase">
                East Coast Mechanical
              </div>
            </div>
          </div>
          <div className="h-6 w-px bg-white/8" />
          <NavLinks />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
