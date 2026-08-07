"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { STARTUP_CHECKLIST_ITEMS, type CheckResult } from "./constants";

function str(formData: FormData, name: string): string | null {
  const value = (formData.get(name) as string)?.trim();
  return value ? value : null;
}

function num(formData: FormData, name: string): number | null {
  const value = formData.get(name) as string;
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ts(formData: FormData, name: string): string | null {
  const value = formData.get(name) as string;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createInstallReport(formData: FormData) {
  const job_id = str(formData, "job_id");
  const equipment_id = str(formData, "equipment_id");

  let customer_id: string | null = null;
  let property_id: string | null = null;

  if (equipment_id) {
    const { data: equipment } = await supabase
      .from("equipment")
      .select("*, properties(id, customer_id)")
      .eq("id", equipment_id)
      .single();
    property_id = equipment?.properties?.id ?? null;
    customer_id = equipment?.properties?.customer_id ?? null;
  }

  const startup_checks = STARTUP_CHECKLIST_ITEMS.map((item, i) => ({
    item,
    result: (formData.get(`check_${i}`) as CheckResult) || "na",
  }));

  const customer_sign_name = str(formData, "customer_sign_name");

  const { data: report, error } = await supabase
    .from("install_reports")
    .insert({
      job_id,
      customer_id,
      property_id,
      equipment_id,
      tech_name: str(formData, "tech_name"),
      system_type: str(formData, "system_type"),
      zone_config: str(formData, "zone_config"),
      brand: str(formData, "brand"),
      model: str(formData, "model"),
      serial: str(formData, "serial"),
      refrigerant_type: str(formData, "refrigerant_type"),
      lineset_size: str(formData, "lineset_size"),
      lineset_total_ft: num(formData, "lineset_total_ft"),
      factory_charge_oz: num(formData, "factory_charge_oz"),
      charge_rate_oz_per_ft: num(formData, "charge_rate_oz_per_ft"),
      actual_charge_added_oz: num(formData, "actual_charge_added_oz"),
      pressure_test_psig: num(formData, "pressure_test_psig"),
      pressure_test_ambient_f: num(formData, "pressure_test_ambient_f"),
      pressure_test_start_at: ts(formData, "pressure_test_start_at"),
      pressure_test_end_at: ts(formData, "pressure_test_end_at"),
      pressure_test_start_psig: num(formData, "pressure_test_start_psig"),
      pressure_test_end_psig: num(formData, "pressure_test_end_psig"),
      vacuum_target_microns: num(formData, "vacuum_target_microns"),
      vacuum_achieved_microns: num(formData, "vacuum_achieved_microns"),
      decay_start_microns: num(formData, "decay_start_microns"),
      decay_end_microns: num(formData, "decay_end_microns"),
      decay_duration_min: num(formData, "decay_duration_min"),
      startup_checks,
      notes: str(formData, "notes"),
      tech_sign_name: str(formData, "tech_sign_name"),
      customer_sign_name,
      signed_at: customer_sign_name ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/tech-hub/install-report");
  if (job_id) revalidatePath("/jobs");
  redirect(`/tech-hub/install-report/${report.id}`);
}
