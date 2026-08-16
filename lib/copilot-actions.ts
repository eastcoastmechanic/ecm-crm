/**
 * The subset of the internal assistant's tools exposed to Microsoft 365
 * Copilot as real HTTP actions, so Copilot can act in the CRM -- not just
 * search it (that's the separate Graph connector in lib/graph-connector.ts).
 *
 * Deliberately reuses the exact same tool objects buildInternalTools()
 * already assembles for Claude's tool-use -- these are already
 * Zod-validated, already call the same server actions the CRM UI uses, and
 * already return LLM-friendly strings. No second implementation to drift.
 *
 * v1 scope, confirmed with Josh: safe operational actions (jobs, leads,
 * inventory, tasks, refrigerant log) plus draft document creation.
 * Deliberately excluded: anything that reaches a customer directly
 * (send_document, service report sends), payment links, and all deletions --
 * those need more guardrails than "an LLM decided to call this" before they
 * belong here.
 */
import { buildInternalTools } from "@/lib/internal-assistant/tools";

export const COPILOT_ACTION_NAMES = [
  "find_customer",
  "list_properties",
  "search_price_book",
  "list_jobs",
  "schedule_job",
  "update_job_status",
  "reschedule_job",
  "list_leads",
  "add_lead",
  "set_lead_stage",
  "list_inventory",
  "adjust_inventory",
  "add_task",
  "list_open_tasks",
  "complete_task",
  "log_refrigerant",
  "list_refrigerant_log",
  "create_estimate",
  "create_invoice",
  "create_proposal",
] as const;

export type CopilotActionName = (typeof COPILOT_ACTION_NAMES)[number];

/**
 * buildInternalTools() returns a union of ~40 differently-typed tools --
 * fine for Claude's tool-use, but calling .run() on a value typed as "one
 * of these 40 possible shapes" collapses its parameter type to `never`
 * (TypeScript can't know which shape survives a runtime .find()). This
 * route only ever wants "some tool, give me its generic parse/run", so
 * that's the type it works with.
 */
export type CopilotActionTool = {
  name: string;
  parse: (raw: unknown) => unknown;
  run: (input: unknown) => Promise<unknown>;
};

/**
 * fast:true on the document-creation tools matters here specifically:
 * pricing a real good/better/best estimate takes 70s+, longer than a
 * Copilot Studio action's own timeout, so this must return immediately and
 * let the document finish generating in the background (same reason the
 * Teams connector uses it).
 */
export function getCopilotActionTools(): CopilotActionTool[] {
  const all = buildInternalTools({ fast: true }) as unknown as CopilotActionTool[];
  return all.filter((tool) => (COPILOT_ACTION_NAMES as readonly string[]).includes(tool.name));
}
