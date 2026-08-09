import { supabase } from "@/lib/supabase";
import { GOOGLE_REVIEWS } from "@/lib/reviews";
import Reveal from "./Reveal";

// First name + last initial only — these are real customers, not staged
// quotes, so we don't publish a full name without asking first.
function displayName(fullName: string | null): string {
  if (!fullName) return "Verified Customer";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function Stars({ rating }: { rating: number }) {
  return (
    <div aria-label={`${rating} out of 5 stars`} className="text-xs tracking-[0.15em] text-highlight">
      {"★".repeat(rating)}
      <span className="text-white/15">{"★".repeat(5 - rating)}</span>
    </div>
  );
}

export default async function Reviews() {
  const { data } = await supabase
    .from("satisfaction_surveys")
    .select("rating, comment, created_at, jobs(customers(name))")
    .gte("rating", 4)
    .not("comment", "is", null)
    .order("created_at", { ascending: false })
    .limit(9);

  const reviews = (data ?? []) as unknown as {
    rating: number;
    comment: string;
    created_at: string;
    jobs: { customers: { name: string | null } | null } | null;
  }[];

  // Two sources, deliberately kept apart. Survey responses are private
  // feedback tied to a real job, so they're shortened to "First L.". The
  // Google ones were already published publicly by their authors under those
  // names, and are labelled as such rather than passed off as survey results.
  const surveyCards = reviews.map((r) => ({
    rating: r.rating,
    comment: r.comment,
    name: displayName(r.jobs?.customers?.name ?? null),
    fromGoogle: false,
  }));

  const googleCards = GOOGLE_REVIEWS.map((r) => ({
    rating: r.rating,
    comment: r.comment,
    name: r.name,
    fromGoogle: true,
  }));

  const cards = [...surveyCards, ...googleCards];
  if (cards.length === 0) return null;

  return (
    <section id="reviews" className="border-y border-white/6 bg-white/2">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <Reveal>
          <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
            What Customers Say
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] text-g300">
            Real feedback from real jobs — from our post-service survey and our Google reviews.
          </p>
          {/* Masonry columns, not a grid: these run from one line (Jake) to a
              full paragraph (Kristen), and a row-based grid pads every card in
              a row out to the tallest one. Columns let them pack tight without
              truncating anyone — a review is the most persuasive thing on the
              page, so clipping it to make boxes line up is the wrong trade. */}
          <div className="mt-8 columns-1 gap-3 sm:columns-2 lg:columns-3">
            {cards.map((r, i) => (
              <div
                key={i}
                className="mb-3 break-inside-avoid rounded-lg border border-white/8 bg-white/3 p-4"
              >
                <Stars rating={r.rating} />
                <p className="mt-2 text-[13px] leading-snug text-g300">&ldquo;{r.comment}&rdquo;</p>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-white">
                    {r.name}
                  </span>
                  {r.fromGoogle && (
                    <span className="text-[10px] uppercase tracking-wide text-g500">Google</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
