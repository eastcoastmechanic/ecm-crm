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

type Unit = {
  label: string | null;
  type: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  refrigerant_type: string | null;
  lineset_size: string | null;
  lineset_ft: number | null;
};

function readUnits(formData: FormData): Unit[] {
  const count = Math.min(Math.max(Number(formData.get("unit_count")) || 0, 0), 20);
  const units: Unit[] = [];
  for (let i = 0; i < count; i++) {
    const unit: Unit = {
      label: str(formData, `unit_${i}_label`),
      type: str(formData, `unit_${i}_type`),
      brand: str(formData, `unit_${i}_brand`),
      model: str(formData, `unit_${i}_model`),
      serial: str(formData, `unit_${i}_serial`),
      refrigerant_type: str(formData, `unit_${i}_refrigerant_type`),
      lineset_size: str(formData, `unit_${i}_lineset_size`),
      lineset_ft: num(formData, `unit_${i}_lineset_ft`),
    };
    // Skip a unit left completely empty.
    if (Object.values(unit).some((v) => v !== null)) units.push(unit);
  }
  return units;
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
  const units = readUnits(formData);
  const first = units[0];
  const unitFtSum = units.reduce((sum, u) => sum + (u.lineset_ft ?? 0), 0);

  const { data: report, error } = await supabase
    .from("install_reports")
    .insert({
      job_id,
      customer_id,
      property_id,
      equipment_id,
      tech_name: str(formData, "tech_name"),
      units,
      // The single-unit columns hold the first unit so lists and the assistant keep working.
      system_type: first?.type ?? null,
      zone_config: str(formData, "zone_config"),
      brand: first?.brand ?? null,
      model: first?.model ?? null,
      serial: first?.serial ?? null,
      refrigerant_type: first?.refrigerant_type ?? null,
      lineset_size: first?.lineset_size ?? null,
      lineset_total_ft: num(formData, "lineset_total_ft") ?? (unitFtSum > 0 ? unitFtSum : null),
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
