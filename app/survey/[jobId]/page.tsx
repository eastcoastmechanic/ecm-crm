import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { submitSurvey } from "./actions";

export const metadata = {
  title: "How did we do? | East Coast Mechanical",
};

const REVIEW_URL = process.env.GOOGLE_REVIEW_URL;

function Header() {
  return (
    <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
      <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-2.5">
        <Image src="/logo-mark.png" alt="ECM logo" width={61} height={52} className="shrink-0" />
        <div className="whitespace-nowrap font-display text-base font-bold tracking-wide">
          East Coast Mechanical
        </div>
      </div>
    </header>
  );
}

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ rating?: string }>;
}) {
  const { jobId } = await params;
  const { rating } = await searchParams;
  const submittedRating = rating ? Number(rating) : null;

  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-g300">
          This survey link isn&apos;t valid. If you have a question about your service, please
          call us directly.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-10 flex flex-col gap-4 text-sm text-g300">
        {submittedRating ? (
          submittedRating >= 4 ? (
            <>
              <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">
                Thanks for the kind words!
              </h1>
              <p>Would you mind leaving us a public review? It helps other homeowners find us.</p>
              {REVIEW_URL ? (
                <a
                  href={REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90"
                >
                  Leave us a review
                </a>
              ) : (
                <p className="text-xs text-g500">(Review link coming soon.)</p>
              )}
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">
                Thanks for letting us know.
              </h1>
              <p>
                We&apos;re sorry it wasn&apos;t a 5-star experience. Someone from our team will
                follow up with you directly.
              </p>
            </>
          )
        ) : (
          <>
            <h1 className="font-display text-2xl font-extrabold tracking-wide text-white">
              How did we do?
            </h1>
            <p>Let us know how your recent service went.</p>
            <form
              action={submitSurvey}
              className="flex flex-col gap-3 rounded-xl border border-white/8 p-4"
            >
              <input type="hidden" name="job_id" value={jobId} />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs text-g300">Rating</legend>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label
                      key={n}
                      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-white/8 bg-white/4 text-sm text-white has-[:checked]:border-accent has-[:checked]:bg-accent/20"
                    >
                      <input
                        type="radio"
                        name="rating"
                        value={n}
                        required
                        className="sr-only"
                      />
                      {n}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Anything you want us to know? (optional)
                <textarea
                  name="comment"
                  rows={3}
                  className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500"
                />
              </label>
              <button
                type="submit"
                className="w-fit rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90"
              >
                Submit
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
