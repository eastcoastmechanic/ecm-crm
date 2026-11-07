import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import UnsubscribeForm from "./UnsubscribeForm";

export const metadata = {
  title: "Unsubscribe | East Coast Mechanical",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public page from the link in campaign emails. Shows no customer details.
// A button, not a one-click link, so email scanners that open links can't
// unsubscribe someone by accident.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: customer } = UUID.test(token)
    ? await supabase.from("customers").select("email_opt_out_at").eq("unsubscribe_token", token).maybeSingle()
    : { data: null };

  let body: React.ReactNode;
  if (!customer) {
    body = <p>This link isn&apos;t valid. Reply to the email, or call {COMPANY_PHONE_DISPLAY}, and we&apos;ll take you off.</p>;
  } else if (customer.email_opt_out_at) {
    body = (
      <p>
        You&apos;re unsubscribed from our offer emails (tune-up offers and check-ins). You&apos;ll still get emails about
        work you book with us or a plan you have, like appointment notices, plan visit reminders and invoices.
      </p>
    );
  } else {
    body = (
      <>
        <p>Stop getting offer emails (tune-up offers and check-ins) from East Coast Mechanical?</p>
        <UnsubscribeForm token={token} />
        <p>To stop texts, reply STOP to any of our texts.</p>
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-highlight after:to-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
          <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
          <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">East Coast Mechanical</div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10 text-sm text-g300">
        <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">Unsubscribe</h1>
        {body}
      </main>
    </div>
  );
}
