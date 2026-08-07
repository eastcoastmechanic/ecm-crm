// Standard startup verification checklist for a completed HVAC install.
// Shared between the form (renders one row per item) and the server action
// (assembles startup_checks jsonb in this same order).
export const STARTUP_CHECKLIST_ITEMS = [
  "Electrical connections tight and verified",
  "Disconnect/breaker sized correctly",
  "Condensate drain tested, no leaks",
  "Thermostat wiring verified and programmed",
  "Filter installed",
  "Unit level and secure",
  "Refrigerant lines insulated and sealed",
  "System cycled, heating/cooling operation verified",
  "Airflow verified at registers/heads",
  "Customer walkthrough completed",
] as const;

export type CheckResult = "yes" | "no" | "na";
