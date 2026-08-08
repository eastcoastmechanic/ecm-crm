import { supabase } from "@/lib/supabase";
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
    <div aria-label={`${rating} out of 5 stars`} className="text-highlight">
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

  if (reviews.length === 0) return null;

  return (
    <section id="reviews" className="border-y border-white/6 bg-white/2">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <h2 className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
            What Customers Say
          </h2>
          <p className="mt-2 max-w-xl text-sm text-g300">
            Real feedback from real jobs, collected right after service.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-5">
                <Stars rating={r.rating} />
                <p className="text-sm text-g300">&ldquo;{r.comment}&rdquo;</p>
                <div className="text-xs font-bold uppercase tracking-wide text-white">
                  {displayName(r.jobs?.customers?.name ?? null)}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
