import type { PmReadingField, PmTemplateItem } from "@/lib/pm/types";

/**
 * Seed definitions for the two PM templates.
 *
 * These are copied into `pm_templates` by db/migrations/0048_preventive_maintenance.sql.
 * After that, the database rows are what new checklists copy, so an office edit
 * does not require a code change. Editing this file does not change templates
 * that have already been seeded (the migration uses ON CONFLICT DO NOTHING).
 */

function readings(...fields: PmReadingField[]): PmReadingField[] {
  return fields;
}

function num(key: string, label: string, unit: string): PmReadingField {
  return { key, label, unit, input: "number" };
}

function text(key: string, label: string, unit?: string): PmReadingField {
  return { key, label, unit, input: "text" };
}

function item(
  key: string,
  section: string,
  label: string,
  fields: PmReadingField[] = [],
  help?: string
): PmTemplateItem {
  return { key, section, label, readings: fields, ...(help ? { help } : {}) };
}

export const RESIDENTIAL_PM_ITEMS: PmTemplateItem[] = [
  item("filters", "Airflow", "Filters", readings(text("size", "Filter size"), text("merv", "MERV")), "Record size and condition. Fail if loaded, collapsed, or the wrong size."),
  item("evaporator_coil", "Airflow", "Evaporator coil", [], "Clean and unobstructed. Note oil stains or ice."),
  item("condenser_coil", "Airflow", "Condenser coil", [], "Fins straight enough to pass air. Note cottonwood, grass, or damage."),

  item("condensate_drain", "Condensate", "Condensate drain", [], "Trap present, line clear, discharge where it belongs."),
  item("condensate_pan", "Condensate", "Condensate pan", [], "No standing sludge, overflow, or rust-through."),
  item("condensate_pump", "Condensate", "Condensate pump", [], "Pumps out and the check valve holds. Mark NA if the unit drains by gravity."),
  item("float_switch", "Condensate", "Float switch", [], "Opens the circuit when the pan is lifted. Mark NA if there is no float."),

  item("electrical_connections", "Electrical", "Electrical connections", [], "Lugs tight, no burned insulation, whip and disconnect in good shape."),
  item(
    "capacitors",
    "Electrical",
    "Capacitors (rated vs measured)",
    readings(
      num("herm_rated_uf", "Herm rated", "µF"),
      num("herm_measured_uf", "Herm measured", "µF"),
      num("fan_rated_uf", "Fan rated", "µF"),
      num("fan_measured_uf", "Fan measured", "µF")
    ),
    "Read the value printed on the capacitor, then measure it. Note any extra capacitors in the notes."
  ),
  item("contactors", "Electrical", "Contactors", [], "Points not pitted, coil pulls in, no chatter."),

  item("suction_pressure", "Refrigerant", "Suction pressure", readings(num("suction_psig", "Suction", "psig"))),
  item("liquid_pressure", "Refrigerant", "Liquid pressure", readings(num("liquid_psig", "Liquid", "psig"))),
  item("superheat", "Refrigerant", "Superheat", readings(num("superheat_f", "Superheat", "°F"))),
  item("subcool", "Refrigerant", "Subcooling", readings(num("subcool_f", "Subcool", "°F"))),

  item(
    "supply_return",
    "Temperatures",
    "Supply / return temperatures and split",
    readings(num("supply_f", "Supply", "°F"), num("return_f", "Return", "°F"), num("split_f", "Temperature split", "°F")),
    "Split is return minus supply for cooling. The form fills a split once both temps are entered; change it if you measured it yourself."
  ),

  item(
    "compressor_amps",
    "Motors",
    "Compressor amps vs RLA",
    readings(num("measured_a", "Measured", "A"), num("rla", "RLA", "A"))
  ),
  item(
    "condenser_fan_amps",
    "Motors",
    "Condenser fan motor amps vs FLA",
    readings(num("measured_a", "Measured", "A"), num("fla", "FLA", "A"))
  ),
  item(
    "blower_amps",
    "Motors",
    "Blower motor amps vs FLA",
    readings(num("measured_a", "Measured", "A"), num("fla", "FLA", "A"))
  ),

  item("burner", "Gas heat", "Burner", [], "Carryover, flame color, and no rollout. Mark NA on electric or heat-pump-only equipment."),
  item("flame_sensor", "Gas heat", "Flame sensor", readings(num("microamps", "Flame signal", "µA")), "Mark NA if the unit has no flame sensor."),
  item("igniter", "Gas heat", "Igniter", [], "Hot-surface or spark. Mark NA if there is no igniter."),
  item("heat_exchanger", "Gas heat", "Heat exchanger", [], "No visible cracks, rust-through, or flame disturbance. Mark NA on electric heat."),
  item(
    "combustion_analysis",
    "Gas heat",
    "Combustion analysis",
    readings(num("o2_pct", "O2", "%"), num("co2_pct", "CO2", "%"), num("stack_f", "Stack temperature", "°F")),
    "Mark NA when a combustion analyzer was not used."
  ),
  item("co_ambient", "Gas heat", "CO ambient", readings(num("ppm", "Ambient CO", "ppm")), "Measured in the occupied space, not in the flue."),
  item("co_flue", "Gas heat", "CO flue", readings(num("ppm", "Flue CO", "ppm"))),
  item("venting", "Gas heat", "Venting", [], "Pitch, clearance, terminations, and no spillage. Mark NA on electric heat."),
  item(
    "gas_pressure",
    "Gas heat",
    "Gas pressure",
    readings(num("inlet_wc", "Inlet", "in. w.c."), num("manifold_wc", "Manifold", "in. w.c.")),
    "Mark NA on electric heat."
  ),

  item("belts", "Drive", "Belts", [], "Tension and wear. Mark NA on direct-drive equipment."),
  item("pulleys", "Drive", "Pulleys", [], "Alignment and set screws. Mark NA on direct-drive equipment."),
  item("bearings", "Drive", "Bearings", [], "No growl, play, or heat. Mark NA if the motor is sealed and not serviceable."),

  item("ductwork", "Distribution", "Ductwork", [], "Connections seated, insulation intact, no obvious leaks at the air handler."),
  item(
    "static_pressure",
    "Distribution",
    "Static pressure",
    readings(
      num("supply_wc", "Supply", "in. w.c."),
      num("return_wc", "Return", "in. w.c."),
      num("total_wc", "Total external", "in. w.c.")
    )
  ),

  item(
    "thermostat_calibration",
    "Controls",
    "Thermostat calibration",
    readings(num("offset_f", "Offset", "°F")),
    "Compare the thermostat to a measured room temperature. Offset is thermostat minus measured."
  ),
  item("thermostat_operation", "Controls", "Thermostat operation", [], "Calls for heat and cool, fan runs in the selected mode, schedule is not fighting the call."),

  item("high_pressure_switch", "Safeties", "High pressure switch", [], "Wired and not jumped."),
  item("low_pressure_switch", "Safeties", "Low pressure switch", [], "Wired and not jumped. Mark NA if the unit has no low-pressure switch."),
  item("limit_switches", "Safeties", "Limit switches", [], "High limit present and not jumped. Mark NA if this unit has no limit."),
  item("rollout_switch", "Safeties", "Rollout switch", [], "Not tripped and not jumped. Mark NA on equipment with no rollout."),
];

export const COMMERCIAL_PM_EXTRA: PmTemplateItem[] = [
  item("economizer_operation", "Rooftop unit", "Economizer operation", [], "Brings in outdoor air when it should and closes when it should not."),
  item("economizer_dampers", "Rooftop unit", "Economizer dampers", [], "Travel fully, seals meet, no stuck blades."),
  item("economizer_actuator", "Rooftop unit", "Economizer actuator", [], "Drives the dampers through the stroke and holds."),
  item("roof_curb", "Rooftop unit", "Curb", [], "Gasket, attachment, and no daylight or water into the curb."),
  item("access_panels", "Rooftop unit", "Panels", [], "Panels on, screws present, rain shedding the right way."),
  item("disconnect", "Rooftop unit", "Disconnect", [], "Within sight, legs intact, cover on."),
  item(
    "multiple_stages",
    "Rooftop unit",
    "Multiple stages",
    readings(
      text("stages", "Stages observed"),
      num("stage_1_a", "Stage 1", "A"),
      num("stage_2_a", "Stage 2", "A")
    ),
    "Run each stage. Record how many stages came in and the amps on the stages you ran."
  ),
];

export const COMMERCIAL_PM_ITEMS: PmTemplateItem[] = [...RESIDENTIAL_PM_ITEMS, ...COMMERCIAL_PM_EXTRA];

export const PM_TEMPLATES = [
  {
    slug: "residential",
    name: "Residential preventive maintenance",
    audience: "residential" as const,
    items: RESIDENTIAL_PM_ITEMS,
  },
  {
    slug: "commercial",
    name: "Commercial rooftop preventive maintenance",
    audience: "commercial" as const,
    items: COMMERCIAL_PM_ITEMS,
  },
];

/** Keys a residential visit has to be able to record. Used by the seed test. */
export const REQUIRED_RESIDENTIAL_KEYS = [
  "filters",
  "evaporator_coil",
  "condenser_coil",
  "condensate_drain",
  "condensate_pan",
  "condensate_pump",
  "float_switch",
  "electrical_connections",
  "capacitors",
  "contactors",
  "suction_pressure",
  "liquid_pressure",
  "superheat",
  "subcool",
  "supply_return",
  "compressor_amps",
  "condenser_fan_amps",
  "blower_amps",
  "burner",
  "flame_sensor",
  "igniter",
  "heat_exchanger",
  "combustion_analysis",
  "co_ambient",
  "co_flue",
  "venting",
  "gas_pressure",
  "belts",
  "pulleys",
  "bearings",
  "ductwork",
  "static_pressure",
  "thermostat_calibration",
  "thermostat_operation",
  "high_pressure_switch",
  "low_pressure_switch",
  "limit_switches",
  "rollout_switch",
] as const;

export const REQUIRED_COMMERCIAL_KEYS = [
  "economizer_operation",
  "economizer_dampers",
  "economizer_actuator",
  "roof_curb",
  "access_panels",
  "disconnect",
  "multiple_stages",
] as const;
