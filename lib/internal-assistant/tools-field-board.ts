import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getFieldBoardSheet, ingestFieldBoardEvent } from "@/lib/field-board";

const listFieldBoardTool = betaZodTool({
  name: "list_field_board",
  description:
    "Read the live Field Board: open jobs, tasks, and recent field notes. Use this before logging a note so you attach the right job id. The Field Board is /field-board in this CRM.",
  inputSchema: z.object({}),
  run: async () => {
    try {
      const sheet = await getFieldBoardSheet();
      return JSON.stringify({
        board: "https://ecm-crm.vercel.app/field-board",
        jobs: sheet.jobs,
        events: sheet.events,
        tasks: sheet.tasks,
      });
    } catch (err) {
      return `Failed to load Field Board: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const logFieldNoteTool = betaZodTool({
  name: "log_field_note",
  description:
    "Write a field update onto the Field Board and, when jobId is a real CRM job, onto that job. Use for on-site status, what you found, or a finished stop. Do not invent a customer. If the job is unknown, still log the note with no jobId.",
  inputSchema: z.object({
    title: z.string().describe("Short update, e.g. On site or Waiting on part"),
    body: z.string().optional().describe("What happened on site"),
    jobId: z.string().optional().describe("CRM job id from list_field_board or list_jobs"),
    boardStatus: z.enum(["active", "needs-attention", "finished"]).optional(),
    crmStatus: z.enum(["requested", "scheduled", "in_progress", "complete", "cancelled"]).optional(),
  }),
  run: async ({ title, body, jobId, boardStatus, crmStatus }) => {
    const result = await ingestFieldBoardEvent({
      source: "crm-assistant",
      title,
      body,
      job_id: jobId,
      board_status: boardStatus,
      crm_status: crmStatus,
    });
    if (!result.ok) return `Failed to log field note: ${result.error}`;
    return result.job_id
      ? `Logged to Field Board and job ${result.job_id}. Open /field-board.`
      : `Logged to Field Board with no job linked. Open /field-board.`;
  },
});

export const fieldBoardTools = [listFieldBoardTool, logFieldNoteTool];
