import { describe, expect, it } from "vitest";
import { createTurnGate } from "../chat-confirm-gate";

const reply = (t: string) =>
  `This will permanently delete customer Jane. Call confirm_action with token "${t}" to proceed. Expires in 10 minutes.`;

describe("createTurnGate", () => {
  it("blocks confirming a token proposed in the same turn", () => {
    const gate = createTurnGate();
    gate.noteProposal(reply("abc-123"));
    expect(gate.blocksConfirm("abc-123")).toBe(true);
  });

  it("ignores case and spaces", () => {
    const gate = createTurnGate();
    gate.noteProposal(reply("ABC-123"));
    expect(gate.blocksConfirm("  abc-123 ")).toBe(true);
  });

  it("lets a token from an earlier turn through", () => {
    const gate = createTurnGate();
    gate.noteProposal(reply("new-token"));
    expect(gate.blocksConfirm("old-token")).toBe(false);
  });

  it("does nothing for replies with no token", () => {
    const gate = createTurnGate();
    gate.noteProposal("Customer has no email on file, can't send.");
    expect(gate.blocksConfirm("anything")).toBe(false);
  });

  it("blocks every token when several are proposed", () => {
    const gate = createTurnGate();
    gate.noteProposal(reply("one"));
    gate.noteProposal(reply("two"));
    expect(gate.blocksConfirm("one")).toBe(true);
    expect(gate.blocksConfirm("two")).toBe(true);
  });
});
