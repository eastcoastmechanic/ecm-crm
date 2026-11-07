import ContactForm from "./ContactForm";
import { headingClass, subTextClass } from "../../(internal)/ui";

export const metadata = {
  title: "Contact Us | East Coast Mechanical",
  description: "Get in touch with East Coast Mechanical — phone, hours, and a contact form.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;

  return (
    <div className="mx-auto grid max-w-4xl gap-10 px-6 py-16 sm:grid-cols-2">
      <div>
        <h1 className={headingClass}>Contact Us</h1>
        <p className={`${subTextClass} mt-3`}>
          Prefer to book directly? Use our{" "}
          <a href="/book" className="font-bold text-accent hover:underline">
            online booking form
          </a>{" "}
          or chat with our AI assistant. For emergencies, call us directly.
        </p>
        <div className="mt-6 flex flex-col gap-1 text-sm text-g300">
          <a href="tel:+17743436369" className="text-lg font-bold text-white hover:text-accent">
            (774) 343-6369
          </a>
          <span>Mon–Sat, 7am–8pm · 24/7 emergency service</span>
          <span>Serving the South Shore through the Cape and Islands</span>
        </div>
      </div>

      <div>
        {success ? (
          <div className="rounded-xl border border-green/30 bg-green/10 p-4 text-white">
            Thanks for reaching out — we&apos;ll get back to you shortly.
          </div>
        ) : (
          <ContactForm />
        )}
      </div>
    </div>
  );
}
