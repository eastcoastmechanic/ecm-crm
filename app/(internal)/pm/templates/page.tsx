import { redirect } from "next/navigation";
import { getStaffRole } from "@/lib/require-role";
import { parseTemplateItems } from "@/lib/pm/schema";
import { supabase } from "@/lib/supabase";
import { headingClass, subTextClass } from "../../ui";
import TemplateEditor from "./TemplateEditor";

export const dynamic = "force-dynamic";

export default async function PmTemplatesPage() {
  const role = await getStaffRole();
  if (role === "tech") redirect("/pm");

  const { data, error } = await supabase.from("pm_templates").select("id, name, items").order("audience");
  if (error) {
    return (
      <p className="text-sm text-accent">
        {error.message}. Apply db/migrations/0048_preventive_maintenance.sql before editing templates.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>PM templates</h1>
        <p className={subTextClass}>
          These lists are stored in the database. Changing one affects the next checklist started from it.
        </p>
      </div>
      {(data ?? []).map((template) => {
        const parsed = parseTemplateItems(template.items);
        if (!parsed.items) {
          return (
            <p key={template.id} className="text-sm text-accent">
              {template.name}: {parsed.error}
            </p>
          );
        }
        return (
          <TemplateEditor
            key={template.id}
            templateId={template.id}
            name={template.name}
            initialItems={parsed.items}
          />
        );
      })}
    </div>
  );
}
