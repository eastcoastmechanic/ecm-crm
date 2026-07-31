"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({
  children,
  pendingText,
  className,
  disabled,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending || disabled} className={`${className} disabled:opacity-50`}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
