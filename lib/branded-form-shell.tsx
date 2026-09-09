import Image from "next/image";
import { COMPANY_NAME, COMPANY_SLOGAN, COMPANY_PHONE } from "./brand";

/** Same letterhead as estimate/invoice PDFs — orange bar, logo, Orbitron, type pill. */
export function BrandedFormShell({
  docType,
  docNumber,
  date,
  children,
}: {
  docType: string;
  docNumber: string | null;
  date: string;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-off text-g700 shadow-[0_12px_40px_rgba(0,0,0,.35)]">
      <div className="h-[5px] bg-accent" />
      <header className="flex items-center justify-between gap-4 bg-navy px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Image src="/logo-mark.png" alt="" width={52} height={44} className="shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-display text-[15px] font-bold tracking-wide text-white sm:text-base">
              {COMPANY_NAME.toUpperCase()}
            </div>
            <div className="mt-0.5 text-[8px] font-semibold tracking-wide text-brand">{COMPANY_SLOGAN}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="inline-block rounded-full bg-accent px-2.5 py-0.5 text-[9px] font-bold tracking-widest text-white">
            {docType.toUpperCase()}
          </div>
          <div className="mt-1 text-sm font-bold text-white">{docNumber}</div>
          <div className="text-[10px] text-g300">{date}</div>
        </div>
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      <footer className="flex items-center justify-between gap-3 bg-navy-2 px-5 py-3 text-[10px] text-g300 sm:px-6">
        <span>
          {COMPANY_NAME} · {COMPANY_PHONE} · eastcoastmechanical.org
        </span>
      </footer>
    </article>
  );
}
