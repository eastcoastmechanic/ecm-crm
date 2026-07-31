import Image from "next/image";
import Link from "next/link";
import { signUpForSms } from "./actions";

export const metadata = {
  title: "Text Message Sign-Up | East Coast Mechanical",
};

export default async function SmsSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;

  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
          <Image src="/logo.png" alt="ECM logo" width={52} height={52} className="shrink-0" />
          <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
            East Coast Mechanical
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10 flex flex-col gap-4 text-sm text-g300">
        <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">
          Get Text Updates About Your Appointments
        </h1>

        {success ? (
          <div className="rounded-xl border border-green/30 bg-green/10 p-4 text-white">
            You&apos;re signed up! You&apos;ll receive text updates about your appointments at the
            number you provided. Reply STOP at any time to opt out.
          </div>
        ) : (
          <>
            <p>
              Sign up below to receive text messages from East Coast Mechanical about your
              scheduled service appointments — confirmations, rescheduling, and reminders.
            </p>

            <form action={signUpForSms} className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
              <label className="flex flex-col gap-1 text-xs text-g300">
                Name (optional)
                <input
                  name="name"
                  placeholder="Your name"
                  className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Phone number
                <input
                  name="phone"
                  type="tel"
                  required
                  placeholder="(555) 555-5555"
                  className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500"
                />
              </label>

              <label className="flex items-start gap-2 text-xs text-g300">
                <input type="checkbox" name="consent" required className="mt-0.5" />
                <span>
                  I agree to receive text messages from East Coast Mechanical about my service
                  appointments. Message frequency varies based on my activity. Message and data
                  rates may apply. Reply STOP at any time to opt out, or HELP for help. See our{" "}
                  <Link href="/privacy" className="underline">
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link href="/terms" className="underline">
                    Terms of Service
                  </Link>
                  .
                </span>
              </label>

              <button
                type="submit"
                className="w-fit rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90"
              >
                Sign Up for Text Updates
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
