import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

/**
 * Where customer replies go.
 *
 * Mail is sent from a dedicated sending subdomain (updates.eastcoastmechanical.org)
 * so bulk sending can't damage the root domain's reputation — but that subdomain
 * has no MX record, so it accepts nothing. Without a Reply-To, every customer who
 * hit reply on an estimate got a bounce, silently, and we only found out because
 * one of them mentioned it.
 *
 * So: send from the subdomain, take replies at the real M365 mailbox. Override
 * per-send where the customer's own address is the right target (the website
 * contact form does this).
 */
export const RESEND_REPLY_TO =
  process.env.RESEND_REPLY_TO ?? "JoshCrowley@eastcoastmechanical.org";
