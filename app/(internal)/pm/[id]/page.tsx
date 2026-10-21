import Link from "next/link";
import { notFound } from "next/navigation";
import { signStoredPhotos } from "@/lib/photo-urls";
import { getChecklist, isUuid } from "@/lib/pm/db";
import { PM_PHOTO_BUCKET } from "@/lib/pm/photos";
import { errorClass, headingClass, subTextClass } from "../../ui";
import ChecklistForm from "./ChecklistForm";

export const dynamic = "force-dynamic";

export default async function PmChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { row, error } = await getChecklist(id);
  if (error) return <p className={errorClass}>{error}</p>;
  if (!row) notFound();

  const items = await Promise.all(
    row.items.map(async (item) => ({
      ...item,
      photos: await signStoredPhotos(
        item.photos.map((photo) => ({ path: photo.path, caption: photo.caption ?? null, url: null })),
        { defaultBucket: PM_PHOTO_BUCKET }
      ),
    }))
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-g300">
          <Link href="/pm" className="underline">
            Maintenance
          </Link>
        </p>
        <h1 className={headingClass}>{row.customer_name}</h1>
        <p className={subTextClass}>
          {row.property_address ? `${row.property_address} · ` : ""}
          {row.equipment_label}
          {row.equipment_serial ? ` · S/N ${row.equipment_serial}` : ""}
        </p>
      </div>
      <ChecklistForm
        checklistId={row.id}
        techName={row.tech_name ?? ""}
        recommendations={row.recommendations ?? ""}
        items={items}
        reportHref={row.document_id ? `/pm/${row.id}/report` : null}
        filed={row.status === "complete"}
      />
    </div>
  );
}
