"use client";

import { headingClass, subTextClass, buttonClass, errorClass } from "../(internal)/ui";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-6 text-center my-16">
      <h1 className={headingClass}>Something went wrong</h1>
      <p className={subTextClass}>
        That didn&apos;t go through. You can try again, or call us directly at (774) 343-6369.
      </p>
      <p className={errorClass}>{error.message}</p>
      <button onClick={() => reset()} className={`${buttonClass} mx-auto`}>
        Try Again
      </button>
    </div>
  );
}
