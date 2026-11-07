import BookForm from "./BookForm";
import { headingClass, subTextClass } from "../../(internal)/ui";

export const metadata = {
  title: "Book Service | East Coast Mechanical",
  description: "Book heating, cooling, or ductless service online with East Coast Mechanical.",
};

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
        <BookForm />
      )}
    </div>
  );
}
