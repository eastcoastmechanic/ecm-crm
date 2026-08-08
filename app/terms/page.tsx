import Image from "next/image";

export const metadata = {
  title: "Terms of Service | East Coast Mechanical",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
          <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
          <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
            East Coast Mechanical
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10 flex flex-col gap-4 text-sm text-g300">
        <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">
          Terms of Service
        </h1>
        <p>Last updated: July 2026</p>

        <p>
          These terms apply to your use of East Coast Mechanical LLC&apos;s (&quot;East Coast
          Mechanical&quot;) services, including our SMS text messaging program.
        </p>

        <h2 className="text-white font-semibold mt-2">Text messaging program</h2>
        <p>
          You may receive text messages from East Coast Mechanical related to scheduling,
          appointment confirmations, rescheduling, and customer service if you text our published
          business number, (774) 355-3465, directly, or if you sign up at{" "}
          <a href="/sms-signup" className="underline">
            ecm-crm.vercel.app/sms-signup
          </a>
          .
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>Message frequency varies based on your activity.</li>
          <li>Message and data rates may apply.</li>
          <li>Reply STOP at any time to opt out of text messages.</li>
          <li>Reply HELP for help.</li>
          <li>
            Any appointment proposed or requested through text message is not confirmed until a
            member of our office staff follows up to confirm it.
          </li>
        </ul>

        <h2 className="text-white font-semibold mt-2">Service scheduling</h2>
        <p>
          Requests submitted by phone, text, or through our website are requests only. Final
          scheduling, pricing, and availability are confirmed directly by East Coast Mechanical
          staff.
        </p>

        <h2 className="text-white font-semibold mt-2">Contact us</h2>
        <p>
          Questions about these terms can be directed to {process.env.OWNER_EMAIL || "our office"}.
        </p>
      </main>
    </div>
  );
}
