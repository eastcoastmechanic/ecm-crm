import Link from "next/link";
import {
  countByFilter,
  filterTimeline,
  TIMELINE_FILTER_LABEL,
  TIMELINE_FILTERS,
  TIMELINE_PAGE_STEP,
  type TimelineCategory,
  type TimelineFilter,
  type TimelineItem,
} from "@/lib/customer-timeline";
import { errorClass, itemSubClass, itemTitleClass, subTextClass } from "../../ui";

const CATEGORY_BADGE: Record<TimelineCategory, string> = {
  texts: "Text",
  calls: "Call",
  money: "Money",
  jobs: "Job",
  notes: "Note",
};

function timelineHref(customerId: string, filter: TimelineFilter, show: number): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("timeline", filter);
  if (show > TIMELINE_PAGE_STEP) params.set("show", String(show));
  const query = params.toString();
  return `/customers/${customerId}${query ? `?${query}` : ""}#timeline`;
}

export default function CustomerTimeline({
  customerId,
  items,
  filter,
  limit,
  failed,
}: {
  customerId: string;
  items: TimelineItem[];
  filter: TimelineFilter;
  limit: number;
  failed: string[];
}) {
  const counts = countByFilter(items);
  const shown = filterTimeline(items, filter);
  const visible = shown.slice(0, limit);

  return (
    <section id="timeline" className="flex flex-col gap-3 scroll-mt-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Timeline</h2>

      <div className="flex flex-wrap gap-2">
        {TIMELINE_FILTERS.map((f) => (
          <Link
            key={f}
            href={timelineHref(customerId, f, TIMELINE_PAGE_STEP)}
            scroll={false}
            aria-current={f === filter ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${
              f === filter ? "border-accent bg-accent/20 text-white" : "border-white/12 text-g300 hover:bg-white/5"
            }`}
          >
            {TIMELINE_FILTER_LABEL[f]} <span className="text-g300">{counts[f]}</span>
          </Link>
        ))}
      </div>

      {failed.length > 0 && (
        <p className={errorClass}>Couldn&apos;t load {failed.join(", ")}. The rest is shown below; refresh to try again.</p>
      )}

      {visible.length === 0 && <p className={subTextClass}>Nothing here yet.</p>}

      <ol className="flex flex-col divide-y divide-white/8">
        {visible.map((item) => {
          const body = (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-12 shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-g300">
                {CATEGORY_BADGE[item.category]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={itemTitleClass}>{item.label}</span>
                  <span className={`${itemSubClass} shrink-0`}>{item.when}</span>
                </div>
                {item.summary && <div className={`${itemSubClass} break-words`}>{item.summary}</div>}
              </div>
            </div>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                <Link href={item.href} className="block py-2 hover:bg-white/3">
                  {body}
                </Link>
              ) : (
                <div className="py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      {shown.length > visible.length && (
        <Link
          href={timelineHref(customerId, filter, limit + TIMELINE_PAGE_STEP)}
          scroll={false}
          className="text-sm font-semibold text-accent"
        >
          Show more ({shown.length - visible.length} older)
        </Link>
      )}
    </section>
  );
}
