import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createLogEntry, foldLogForAssistant, listLogForAssistant } from "@/lib/running-log-store";
import { LOG_SECTION_LABEL, normalizeSectionName, parseAddLogToolInput, parseLogTarget } from "@/lib/running-log";

// Running log (/log) for the assistant: the CRM chat, the Teams/Copilot agent and MCP.
// Nothing here deletes, so no propose/confirm step. Owner and office only: the store
// checks the role inside every call, and buildInternalTools drops these for a tech.

export const LOG_TOOL_NAMES = ["add_log_entry", "list_log", "fold_log_entry", "unfold_log_entry"] as const;

const SECTION_HELP = "Texts, Plans, Jobs, or Vendors / parts";

function sectionOrError(value: string | undefined): { section: ReturnType<typeof normalizeSectionName> } | { error: string } {
  if (!value?.trim()) return { section: null };
  const section = normalizeSectionName(value);
  return section ? { section } : { error: `Section must be ${SECTION_HELP}.` };
}

/** `via` marks entries added through an agent, e.g. "Teams agent". */
export function buildLogTools(via: string) {
  const addLogEntryTool = betaZodTool({
    name: "add_log_entry",
    description:
      "Add a note to the running log (the CRM's Log page), e.g. 'log in Plans: call Ferguson about the condenser'. Sections: Texts, Plans, Jobs, Vendors / parts. A Jobs entry can link a job (jobId from list_jobs) and also lands in that job's Notebook; a Texts entry can link a customer (customerId from find_customer). Posts to the matching Teams channel. Nothing reaches a customer.",
    inputSchema: z.object({
      section: z.string().describe(SECTION_HELP),
      text: z.string().describe("The note, in the user's own words"),
      jobId: z.string().optional().describe("Jobs section only: the job's id from list_jobs"),
      customerId: z.string().optional().describe("Texts section only: the customer's id from find_customer"),
    }),
    run: async (input) => {
      const parsed = parseAddLogToolInput(input);
      if ("error" in parsed) return parsed.error;
      const { section, body, jobId, customerId } = parsed.value;
      const result = await createLogEntry({ section, body, jobId, customerId }, { via });
      if ("error" in result) return `Couldn't add it: ${result.error}`;
      return [`Added to ${LOG_SECTION_LABEL[section]} (entry ${result.id}).`, result.warning].filter(Boolean).join(" ");
    },
  });

  const listLogTool = betaZodTool({
    name: "list_log",
    description:
      "List running-log entries, newest first, with their ids. Open entries only unless includeFolded is true. Optionally one section.",
    inputSchema: z.object({
      section: z.string().optional().describe(`${SECTION_HELP}; leave out for all`),
      includeFolded: z.boolean().optional(),
    }),
    run: async ({ section, includeFolded }) => {
      const s = sectionOrError(section);
      if ("error" in s) return s.error;
      return listLogForAssistant({ section: s.section, includeFolded: includeFolded === true });
    },
  });

  const foldTool = (folded: boolean) =>
    betaZodTool({
      name: folded ? "fold_log_entry" : "unfold_log_entry",
      description: folded
        ? "Fold a running-log entry away (it stays in the log under Folded; nothing is deleted). Pass its id from list_log, or a short piece of its text. If the text matches more than one entry you get the candidates back: ask the user which, then call again with the id."
        : "Bring a folded running-log entry back to the open list. Pass its id from list_log (includeFolded), or a short piece of its text. If the text matches more than one entry you get the candidates back: ask the user which, then call again with the id.",
      inputSchema: z.object({
        id: z.string().optional().describe("The entry id from list_log"),
        match: z.string().optional().describe("A short piece of the entry's text, if there's no id"),
        section: z.string().optional().describe(`Narrow a text match to one section: ${SECTION_HELP}`),
      }),
      run: async ({ id, match, section }) => {
        const target = parseLogTarget({ id, match });
        if ("error" in target) return target.error;
        const s = sectionOrError(section);
        if ("error" in s) return s.error;
        return foldLogForAssistant(target, folded, s.section);
      },
    });

  return [addLogEntryTool, listLogTool, foldTool(true), foldTool(false)];
}
