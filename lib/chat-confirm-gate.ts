/**
 * Same-turn guard for the chat assistant's propose/confirm flow.
 *
 * propose_* tools hand back a confirmation token. In the chat, the model holds
 * both the propose and the confirm tools, so text it read (an attachment, a
 * customer note, a pasted email) could talk it into proposing and confirming a
 * delete or send in one go, and the owner would never see it. This keeps a
 * token minted during a request from being confirmed in that same request, so
 * a real owner message always sits in between. No supabase imports here so it
 * tests on its own.
 */

export const SAME_TURN_MESSAGE =
  "Not confirmed. I can't confirm an action in the same turn I proposed it. Tell the owner what will happen and wait for their yes, then call confirm_action in your next turn.";

const TOKEN_IN_TEXT = /token "([^"]+)"/g;

export function createTurnGate() {
  const minted = new Set<string>();
  return {
    /** Record any confirmation tokens found in a propose_* tool's reply. */
    noteProposal(reply: string) {
      for (const match of reply.matchAll(TOKEN_IN_TEXT)) minted.add(match[1].trim().toLowerCase());
    },
    /** True when this token was minted earlier in the same request. */
    blocksConfirm(token: string) {
      return minted.has(token.trim().toLowerCase());
    },
  };
}
