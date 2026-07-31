import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

/**
 * A "requested" job from an anonymous website visitor (booking form or
 * chatbot) doesn't otherwise surface anywhere until staff happen to check
 * the Jobs list — unlike scheduled jobs, which already email OWNER_EMAIL.
 * This fires immediately so a new web lead doesn't sit unseen.
 */
export async function notifyOwnerOfWebLead(params: {
  source: "web_form" | "web_chat";
  customerName: string;
  phone: string | null;
  address: string;
  description: string;
  scheduledAt: Date;
}) {
  if (!OWNER_EMAIL) return;

  const { source, customerName, phone, address, description, scheduledAt } = params;
  const sourceLabel = source === "web_chat" ? "AI chatbot" : "website booking form";

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `New web lead: ${customerName}`,
    text: `New service request from the ${sourceLabel}, pending confirmation.

Name: ${customerName}
Phone: ${phone ?? "not provided"}
Address: ${address}
Requested time: ${scheduledAt.toLocaleString()}
Details: ${description}

Review and confirm in the Jobs tab.`,
  });
}

/**
 * A 1-3 star survey response means an unhappy customer is about to be asked
 * to leave a public review — catch it here instead, before it becomes one.
 */
export async function notifyOwnerOfLowSurveyRating(params: {
  customerName: string;
  rating: number;
  comment: string | null;
}) {
  if (!OWNER_EMAIL) return;

  const { customerName, rating, comment } = params;

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `Low survey rating (${rating}/5) from ${customerName}`,
    text: `${customerName} rated their recent service ${rating}/5.

${comment ? `Their comment: "${comment}"` : "No comment left."}

Worth a follow-up call before this turns into a public review.`,
  });
}

/**
 * A referred customer just had their first paid invoice — the referral
 * hasn't been auto-rewarded (that's a manual credit decision), just flagged
 * so it doesn't get forgotten.
 */
export async function notifyOwnerOfReferralReward(params: {
  referrerName: string;
  referrerId: string;
  referredName: string;
}) {
  if (!OWNER_EMAIL) return;

  const { referrerName, referrerId, referredName } = params;

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `Referral reward due: ${referrerName}`,
    text: `${referredName}, who was referred by ${referrerName}, just had their first invoice paid.

${referrerName} is due a referral reward. Review and issue it manually — this is just a reminder, nothing was charged or credited automatically.

Referrer customer ID: ${referrerId}`,
  });
}
