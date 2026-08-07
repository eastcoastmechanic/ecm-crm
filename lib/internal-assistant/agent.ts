import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { buildInternalTools } from "./tools";

export type ChatAttachment = { name: string; mediaType: string; base64: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; attachments?: ChatAttachment[] };

// Anthropic's documented ceiling for PDF input (Messages API): ~32MB and
// ~100 pages per document. There's no cheap way to count pages client-side
// without a PDF library, so this guards on size and otherwise lets the API
// itself reject an over-length PDF -- caught below and turned into a plain
// chat reply instead of a 500.
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

function attachmentsToFiles(attachments: ChatAttachment[]): File[] {
  return attachments.map((a) => {
    const bytes = Buffer.from(a.base64, "base64");
    return new File([bytes], a.name, { type: a.mediaType });
  });
}

function buildSystemPrompt() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return `Today's date is ${today} (America/New_York). Use this to resolve relative dates like "tomorrow," "next Friday," or "in two weeks" into an actual YYYY-MM-DD before calling a tool — never leave a due date as free text like "tomorrow" when a tool expects YYYY-MM-DD.

You are the internal AI assistant inside East Coast Mechanical's CRM, talking directly to the owner/staff (not a customer). You can:
- Add, edit, or delete a customer
- Look up an existing customer
- Add, edit, or delete a customer's properties and equipment
- Look up a real sell price from the price book for a quick question (search_price_book) — use this for "how much is X" instead of generating a full document, which takes much longer and creates a saved record
- Generate a real estimate, invoice, or proposal (pulling from the actual price book) — defaults to good/better/best tiered pricing, but if asked for a flat rate / single price / "just one line, no tiers", pass pricingMode "flat" instead
- Create a real warranty registration document for a customer/property (create_warranty) — covers one or more pieces of equipment, computes expiration dates automatically
- Create a draft Mass Save Air Source Heat Pump rebate application (create_mass_save_rebate) — most fields are optional and left blank for the office to finish in the app; it's a real linked draft document, not a substitute for a task/reminder
- Edit or delete any document — estimates, invoices, proposals, assessments, warranties, Mass Save rebates
- Edit warranty details on an existing warranty document (installer name, model, serial number, install date, docket number, manufacturer warranty length, registration)
- Add, list, and complete tasks/to-dos, optionally linked to a customer

If the tech attaches a PDF plan set or jobsite photos, you can see them directly in this message. For a quick question about what's on them, just answer from what you see. If asked to bid/quote/estimate the job from the plans, call create_estimate (or invoice/proposal) — the attachment is passed through automatically and Claude will read it alongside the price book when pricing the document, same as the manual "New Document" form. Say plainly that quantities/scope read from a plan set are a draft for the tech to verify, not a substitute for a real take-off — don't present it as final.

When asked to "add"/"attach"/"link" a warranty or Mass Save rebate to a customer, actually create that document with create_warranty / create_mass_save_rebate — don't fall back to creating a task/reminder instead unless the user specifically asks for a reminder, or is missing information needed to actually create the document (in which case ask for it).

Deleting a customer, property, or piece of equipment also permanently deletes everything under it (customer: properties, equipment, jobs, documents, diagnostics, SMS history, service contracts; property: equipment, jobs, documents, service contracts; equipment: diagnostics). State that plainly before/when you do it — these deletes cannot be undone.

Before editing, deleting, or adding something nested under a customer (a property, a piece of equipment, a document), look up the id first: find_customer for the customer, then list_properties / list_equipment / list_documents as needed. Don't guess ids.

Unlike a customer-facing assistant, when you take an action here it's real and final immediately — there's no "pending confirmation" step. Just do what's asked and clearly state what you did (e.g. "Added customer Jane Doe" or "Created EST-1042 for Jane Doe — Better $2,400"). If a required detail is missing (like which customer, for a new document), ask for it rather than guessing. Keep replies brief and concrete.`;
}

// `fast: true` is for callers with a hard response-time budget (Copilot
// Studio/Teams connectors time out around 100s) -- lowers the thinking
// effort ceiling so the assistant's own reasoning can't run long, AND
// flows through to buildInternalTools so document-generation tools
// (create_estimate/invoice/proposal) use a faster model for their own
// separate Claude call too -- that inner call alone (pricing 3 tiers
// against the full price book on Opus) can take 20-60s+, which the
// outer effort setting alone doesn't touch. The CRM's own chat widget
// (no such external timeout) keeps the default "medium"/Opus everywhere
// for better judgment on tricky asks.
export async function respondToInternalChat(
  messages: ChatMessage[],
  options?: { fast?: boolean }
): Promise<string> {
  // Attachments only ever ride along on the turn they're sent on, not
  // resent from history on every later turn — a 30MB plan set re-embedded
  // on every follow-up message would blow up token cost fast for no benefit
  // once the model has already answered from it once.
  const lastIndex = messages.length - 1;
  const lastAttachments = messages[lastIndex]?.attachments ?? [];

  const totalBytes = lastAttachments.reduce((sum, a) => sum + Buffer.byteLength(a.base64, "base64"), 0);
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    return "That file's too large for me to read (over 32MB, or roughly 100 pages for a PDF). Try uploading just the relevant sheets instead of the full set.";
  }

  const attachmentFiles = lastAttachments.length ? attachmentsToFiles(lastAttachments) : [];

  const apiMessages = messages.map((m, i) => {
    if (i !== lastIndex || m.attachments === undefined || m.attachments.length === 0) {
      return { role: m.role, content: m.content };
    }
    const blocks = m.attachments.map((a) =>
      a.mediaType === "application/pdf"
        ? ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.base64 } })
        : ({ type: "image" as const, source: { type: "base64" as const, media_type: a.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: a.base64 } })
    );
    return { role: m.role, content: [...blocks, { type: "text" as const, text: m.content }] };
  });

  const toolRunnerStartedAt = Date.now();
  let finalMessage;
  try {
    finalMessage = await claude.beta.messages.toolRunner({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: buildSystemPrompt(),
      thinking: { type: "adaptive" },
      output_config: { effort: options?.fast ? "low" : "medium" },
      tools: buildInternalTools({ fast: options?.fast, attachmentFiles }),
      messages: apiMessages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/page/i.test(msg) && /limit|exceed|too many/i.test(msg)) {
      return "That PDF has too many pages for me to read in one go (limit is around 100). Try uploading just the mechanical/plumbing sheets instead of the full set.";
    }
    throw err;
  }
  console.log(`[respondToInternalChat] toolRunner ${Date.now() - toolRunnerStartedAt}ms`);

  return finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
