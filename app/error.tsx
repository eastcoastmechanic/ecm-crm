"use client";

import { headingClass, subTextClass, buttonClass } from "./(internal)/ui";

/**
 * Catch-all for pages outside the CRM, portal and marketing groups (login, survey,
 * text sign-up, unsubscribe, visit links). Production hides the real message, so
 * this never shows it; the reference code matches the server log.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <div className="mx-auto my-16 flex max-w-lg flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-6 text-center">
      <h1 className={headingClass}>Something went wrong</h1>
      <p className={subTextClass}>
        That didn&apos;t go through on our end. Try again, or call East Coast Mechanical at{" "}
        <a href="tel:+17743436369" className="text-accent underline">
          (774) 343-6369
        </a>
        .
      </p>
      {digest && <p className="text-xs text-g300">Reference: {digest}</p>}
      <button type="button" onClick={() => retry()} className={`${buttonClass} mx-auto`}>
        Try Again
      </button>
    </div>
  );
}
