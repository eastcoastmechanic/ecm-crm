import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStaffRole } from "@/lib/require-role";
import { CAMPAIGN_KINDS, CAMPAIGN_LABEL, parseKind, PLACEHOLDERS, templateReady, type Template } from "@/lib/campaigns";
import { buildAudience, type AudienceRow } from "@/lib/campaign-send";
import { SendForm, TemplateForm } from "./CampaignForms";
import { buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

const sectionTitle = "text-xs font-bold uppercase tracking-wide text-g300";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if ((await getStaffRole()) !== "owner") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className={headingClass}>Campaigns</h1>
        <p className={subTextClass}>Campaigns are for the owner only.</p>
      </div>
    );
  }

  const kind = parseKind((await searchParams).kind) ?? "lapsed";
  const { data: templateRow, error: templateError } = await supabase
    .from("campaign_templates")
    .select("sms_text, email_subject, email_body")
    .eq("kind", kind)
    .maybeSingle();
  const template: Template = templateRow ?? { sms_text: null, email_subject: null, email_body: null };

  let audience: AudienceRow[] = [];
  let audienceError: string | null = null;
  try {
    audience = await buildAudience(kind);
  } catch {
    audienceError = templateError
      ? "Run db/migrations/0067_campaigns.sql in Supabase to turn on campaigns."
      : "Couldn't build the list. Refresh to try again.";
  }
  const going = audience.filter((r) => r.channel);
  const notGoing = audience.filter((r) => !r.channel);
  const ready = templateReady(template);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className={headingClass}>Campaigns</h1>
          <p className={subTextClass}>
            Owner only. Nothing sends until you press Send. Text goes only to customers who agreed to texts and
            haven&apos;t texted STOP; everyone else with an email gets an email. Nobody gets more than one campaign
            message in 30 days. Customers with an open job or an active plan are left out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CAMPAIGN_KINDS.map((k) => (
            <Link
              key={k}
              href={`/campaigns?kind=${k}`}
              className={`${buttonSecondaryClass} ${k === kind ? "border-gold text-gold" : ""}`}
            >
              {CAMPAIGN_LABEL[k]}
            </Link>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Wording: {CAMPAIGN_LABEL[kind]}</h2>
        <TemplateForm key={kind} kind={kind} initial={template} placeholders={PLACEHOLDERS} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Send</h2>
        {audienceError ? (
          <p className="text-sm text-accent">{audienceError}</p>
        ) : (
          <SendForm key={kind} kind={kind} count={going.length} ready={ready} />
        )}
      </section>

      {!audienceError && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionTitle}>
            Will get it ({going.length}: {going.filter((r) => r.channel === "sms").length} by text,{" "}
            {going.filter((r) => r.channel === "email").length} by email)
          </h2>
          <div className="flex flex-col divide-y divide-white/8">
            {going.length === 0 && <p className={subTextClass}>Nobody right now.</p>}
            {going.map((r) => (
              <div key={r.customerId} className="flex items-center justify-between py-2">
                <Link href={`/customers/${r.customerId}`} className={itemTitleClass}>
                  {r.name}
                </Link>
                <span className={itemSubClass}>{r.channel === "sms" ? "Text" : "Email"}</span>
              </div>
            ))}
          </div>

          <details className="mt-4">
            <summary className={`${sectionTitle} cursor-pointer`}>Left out ({notGoing.length})</summary>
            <div className="mt-2 flex flex-col divide-y divide-white/8">
              {notGoing.map((r) => (
                <div key={r.customerId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-white">{r.name}</span>
                  <span className={itemSubClass}>{r.reason}</span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
