import { headers } from "next/headers";
import ChatWidget from "./ChatWidget";
import AppTabs from "./AppTabs";
import AppHeader from "./AppHeader";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staffRole = (await headers()).get("x-staff-role");

  return (
    <div className="app-shell min-h-dvh bg-navy md:pl-52 print:bg-white print:pl-0">
      <div className="print:hidden">
        <AppHeader role={staffRole} />
      </div>
      <main className="mx-auto max-w-6xl px-4 py-5 pb-[calc(6.25rem+env(safe-area-inset-bottom))] md:px-6 md:py-8 md:pb-8 print:max-w-none print:bg-white print:p-0 print:pb-0">
        {children}
      </main>
      <div className="print:hidden">
        <AppTabs role={staffRole} />
        <ChatWidget />
      </div>
    </div>
  );
}
