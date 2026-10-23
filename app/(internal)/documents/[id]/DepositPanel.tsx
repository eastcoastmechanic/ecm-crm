import SubmitButton from "../../SubmitButton";
import { buttonClass, inputClass, subTextClass } from "../../ui";
import { recordContractDeposit } from "./actions";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function DepositPanel({
  id,
  total,
  depositCents,
  receivedAt,
  method,
}: {
  id: string;
  total: number | null;
  depositCents: number | null;
  receivedAt: string | null;
  method: string | null;
}) {
  const deposit = depositCents != null ? depositCents / 100 : null;
  const balance = total != null && deposit != null ? Math.max(total - deposit, 0) : null;
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-g300">Deposit &amp; balance</div>
      {deposit != null ? (
        <p className="mt-1 text-sm">
          Deposit received {money(deposit)}
          {receivedAt ? ` on ${receivedAt}` : ""}
          {method ? ` (${method})` : ""}
          {balance != null ? ` · Balance due at completion ${money(balance)}` : ""}
        </p>
      ) : (
        <p className={`mt-1 ${subTextClass}`}>No deposit recorded yet{total != null ? ` · Contract total ${money(total)}` : ""}</p>
      )}
      <form action={recordContractDeposit} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="amount" inputMode="decimal" placeholder="Amount" defaultValue={deposit ?? ""} className={`${inputClass} w-28`} />
        <input name="received_at" type="date" defaultValue={receivedAt ?? ""} className={`${inputClass} w-40`} />
        <select name="method" defaultValue={method ?? "card"} className={`${inputClass} w-32`}>
          <option value="card">Card</option>
          <option value="square">Square</option>
          <option value="check">Check</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
        <SubmitButton className={buttonClass} pendingText="Saving…">
          {deposit != null ? "Update" : "Record deposit"}
        </SubmitButton>
      </form>
      <p className={`mt-2 ${subTextClass}`}>Leave the amount empty and save to clear it.</p>
    </div>
  );
}
