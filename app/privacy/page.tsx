import Image from "next/image";

export const metadata = {
  title: "Privacy Policy | East Coast Mechanical",
};

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p>Last updated: July 2026</p>

        <p>
          East Coast Mechanical LLC (&quot;East Coast Mechanical,&quot; &quot;we,&quot; &quot;us&quot;) provides
          HVAC, plumbing, and heating services. This policy explains what information we collect
          when you contact us, request service, or text our business phone number, and how we use it.
        </p>

        <h2 className="text-white font-semibold mt-2">Information we collect</h2>
        <p>
          We collect information you provide directly, such as your name, phone number, email
          address, service address, and a description of the service you need. This may be
          submitted through our website, over the phone, or by text message.
        </p>

        <h2 className="text-white font-semibold mt-2">SMS / text messaging</h2>
        <p>
          You may receive text messages from us related to scheduling, appointment confirmations,
          and customer service if you text our business number, (774) 355-3465, directly, or if
          you sign up at{" "}
          <a href="/sms-signup" className="underline">
            ecm-crm.vercel.app/sms-signup
          </a>
          . Message frequency varies based on your activity. Message and data rates may apply.
          You can reply STOP at any time to opt out of text messages, or HELP for assistance.
        </p>
        <p>
          <strong>
            We do not share or sell mobile phone numbers collected for SMS purposes with third
            parties or affiliates for marketing or promotional purposes.
          </strong>{" "}
          Phone numbers are used solely to communicate with you about your own service requests
          and appointments.
        </p>

        <h2 className="text-white font-semibold mt-2">How we use information</h2>
        <p>
          We use the information you provide to schedule and perform service, communicate with
          you about appointments, and maintain records of work performed at your property. We do
          not sell your personal information.
        </p>

        <h2 className="text-white font-semibold mt-2">Contact us</h2>
        <p>
          If you have questions about this policy or how your information is used, contact us at{" "}
          {process.env.OWNER_EMAIL || "our office"}.
        </p>
      </main>
    </div>
  );
}
