import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "East Coast Mechanical",
  description: "Customer portal for East Coast Mechanical",
  manifest: "/api/portal-manifest",
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
          <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
          <div className="leading-tight">
            <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
              East Coast Mechanical
            </div>
            <div className="font-mono text-[9px] tracking-widest text-g300 uppercase">
              Customer Portal
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
