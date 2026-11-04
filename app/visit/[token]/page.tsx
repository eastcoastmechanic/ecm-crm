import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import { formatEtDateTime } from "@/lib/tz";
import { monthName } from "@/lib/maintenance-visits";
import RequestForm from "./RequestForm";

export const metadata = {
  title: "Book your maintenance visit | East Coast Mechanical",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-highlight after:to-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
          <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
          <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">East Coast Mechanical</div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10 text-sm text-g300">{children}</main>
    </div>
  );
}

type JobRel = { scheduled_at: string | null };

export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: visit } = UUID.test(token)
    ? await supabase
        .from("maintenance_visits")
        .select("label, due_month, status, customer_request_at, jobs(scheduled_at)")
        .eq("confirm_token", token)
        .maybeSingle()
    : { data: null };

  if (!visit) {
    return (
      <Shell>
        <p>This link isn&apos;t valid. Please call us at {COMPANY_PHONE_DISPLAY} and we&apos;ll book your visit.</p>
      </Shell>
    );
  }

  const label = visit.label ?? "Maintenance visit";
  const job = (Array.isArray(visit.jobs) ? visit.jobs[0] : visit.jobs) as JobRel | null;
  const heading = `${label}, ${monthName(visit.due_month as number)}`;

  let body: React.ReactNode;
  if (visit.status === "complete") {
    body = <p>This visit is done. Thank you!</p>;
  } else if (job?.scheduled_at) {
    body = <p>You&apos;re booked for {formatEtDateTime(job.scheduled_at)}. See you then.</p>;
  } else if (visit.customer_request_at) {
    body = (
      <p>
        We got your request and will be in touch to set a day. Need it sooner? Call {COMPANY_PHONE_DISPLAY}.
      </p>
    );
  } else {
    body = (
      <>
        <p>Your maintenance plan includes this visit. Tell us when works and we&apos;ll get you on the schedule.</p>
        <RequestForm token={token} />
      </>
    );
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">{heading}</h1>
      {body}
    </Shell>
  );
}
