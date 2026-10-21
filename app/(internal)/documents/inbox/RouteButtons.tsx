"use client";

import { useActionState } from "react";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass } from "../../ui";
import { routeToCrm, routeToSquare, type RouteResult } from "./actions";

export default function RouteButtons({ documentId }: { documentId: string }) {
  const [crmState, crmAction] = useActionState(
    async (): Promise<RouteResult | null> => routeToCrm(documentId),
    null
  );
  const [squareState, squareAction] = useActionState(
    async (): Promise<RouteResult | null> => routeToSquare(documentId),
    null
  );
  const error = crmState?.error ?? squareState?.error;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <form action={crmAction}>
          <SubmitButton className={buttonSecondaryClass} pendingText="Saving…">
            Create in CRM
          </SubmitButton>
        </form>
        <form action={squareAction}>
          <SubmitButton className={buttonClass} pendingText="Sending to Square…">
            Create in Square
          </SubmitButton>
        </form>
      </div>
      {error && <p className={`${errorClass} max-w-sm sm:text-right`}>{error}</p>}
    </div>
  );
}
