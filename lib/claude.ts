import Anthropic from "@anthropic-ai/sdk";

export const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Flagship: price-book estimate/invoice/proposal generation, HVAC fault
// diagnosis, and the internal CRM assistant's own tool orchestration --
// tasks where a wrong call has real cost (mispriced work, bad repair
// advice, an unreviewed write to real customer data with no confirmation
// step).
export const CLAUDE_MODEL = "claude-opus-5";

// Balanced: customer-facing conversational agents (bookings are a
// pending request the office confirms, so lower stakes than a direct
// write) and moderate judgment/write-up tasks.
export const CLAUDE_MODEL_BALANCED = "claude-sonnet-5";

// Fast: structured extraction and templated drafting with low ambiguity
// and low individual stakes -- wrong output here is cheap to ignore or
// re-run, not something a customer or technician acts on directly.
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5-20251001";
