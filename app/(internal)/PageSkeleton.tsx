// Shown by loading.tsx while a page's server data loads, so the screen
// responds right away instead of sitting blank.
export default function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-8 w-48 rounded-lg bg-white/8" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl border border-white/8 bg-white/3" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-14 rounded-xl border border-white/8 bg-white/3" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
