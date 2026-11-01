// Posts a short card to a Microsoft Teams channel through a Power Automate
// "Workflows" webhook. One webhook URL per channel, each kept in a Vercel
// secret. A channel with no URL configured is simply skipped.
//
// The URL is a password for posting to that channel: never log it, never put it
// in a message or an error.

export type TeamsChannel =
  | "dispatch"
  | "job_notes"
  | "money"
  | "service_plans"
  | "leads"
  | "parts"
  | "reviews"
  | "general";

const ENV_KEYS: Record<TeamsChannel, string> = {
  dispatch: "TEAMS_WEBHOOK_DISPATCH",
  job_notes: "TEAMS_WEBHOOK_JOB_NOTES",
  money: "TEAMS_WEBHOOK_MONEY",
  service_plans: "TEAMS_WEBHOOK_SERVICE_PLANS",
  leads: "TEAMS_WEBHOOK_LEADS",
  parts: "TEAMS_WEBHOOK_PARTS",
  reviews: "TEAMS_WEBHOOK_REVIEWS",
  general: "TEAMS_WEBHOOK_GENERAL",
};

export function teamsConfigured(channel: TeamsChannel): boolean {
  return Boolean(process.env[ENV_KEYS[channel]]);
}

/**
 * Sends one card. Never throws and gives up after a few seconds: a Teams
 * outage must not slow down or fail the thing being reported.
 *
 * The body carries the fields (title, text, url) for flows built with a request
 * schema, and the same content as an Adaptive Card for the standard Teams
 * "webhook" template, so either style of flow can post it.
 */
export async function postToTeams(
  channel: TeamsChannel,
  card: { title: string; text?: string; url?: string }
): Promise<boolean> {
  const webhook = process.env[ENV_KEYS[channel]];
  if (!webhook) return false;

  const body = [
    { type: "TextBlock", text: card.title, weight: "Bolder", size: "Medium", wrap: true },
    ...(card.text ? [{ type: "TextBlock", text: card.text, wrap: true }] : []),
  ];

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        title: card.title,
        text: card.text ?? "",
        url: card.url ?? "",
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body,
              ...(card.url
                ? { actions: [{ type: "Action.OpenUrl", title: "Open in ECM CRM", url: card.url }] }
                : {}),
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[teams] ${channel} post failed with status ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // Message only: the error text for a failed fetch can include the URL.
    console.error(`[teams] ${channel} post failed:`, err instanceof Error ? err.name : "error");
    return false;
  }
}
