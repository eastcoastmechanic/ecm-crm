import Link from "next/link";
import { bookService } from "./actions";
import SubmitButton from "../../(internal)/SubmitButton";
import { inputClass, buttonClass, headingClass, subTextClass } from "../../(internal)/ui";

export const metadata = {
  title: "Book Service | East Coast Mechanical",
  description: "Book heating, cooling, or ductless service online with East Coast Mechanical.",
};

const SERVICE_TYPES = [
  "Heating repair or installation",
  "Cooling / AC repair or installation",
  "Ductless mini-split",
  "Ductwork",
  "Heat pump",
  "Air quality / filtration",
  "Maintenance / tune-up",
  "Something else",
];

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className={headingClass}>Book Your Service</h1>
        <p className={`${subTextClass} mt-2`}>
          Tell us what you need — we&apos;ll confirm your appointment shortly. For emergencies,{" "}
          <a href="tel:+17743436369" className="text-accent underline">
            call us directly
          </a>{" "}
          instead.
        </p>
      </div>

      {success ? (
        <div className="rounded-xl border border-green/30 bg-green/10 p-4 text-white">
          Request received! We&apos;ll reach out shortly to confirm your appointment time.
        </div>
      ) : (
        <form
          action={bookService}
          className="flex flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Name
              <input name="name" required className={inputClass} placeholder="Your full name" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Phone
              <input
                name="phone"
                type="tel"
                required
                className={inputClass}
                placeholder="(555) 555-5555"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-g300">
            Email (optional)
            <input name="email" type="email" className={inputClass} placeholder="you@example.com" />
          </label>

          <label className="flex flex-col gap-1 text-xs text-g300">
            Service address
            <input name="address" required className={inputClass} placeholder="Street, city" />
          </label>

          <label className="flex flex-col gap-1 text-xs text-g300">
            Service type
            <select name="service_type" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Select a service
              </option>
              {SERVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Preferred date
              <input name="date" type="date" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Preferred time
              <select name="window" defaultValue="morning" className={inputClass}>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-g300">
            Details (optional)
            <textarea
              name="notes"
              rows={3}
              className={inputClass}
              placeholder="Tell us more about what's going on"
            />
          </label>

          <label className="flex items-start gap-2 text-xs text-g300">
            <input type="checkbox" name="sms_consent" className="mt-0.5" />
            <span>
              Text me updates about my appointment. Message and data rates may apply, reply STOP to
              opt out. See our{" "}
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

          <SubmitButton className={`${buttonClass} w-fit`} pendingText="Submitting…">
            Request Appointment
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
