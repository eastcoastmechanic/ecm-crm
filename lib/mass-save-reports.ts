import { supabase } from "@/lib/supabase";
import type { MassSaveFillInput } from "@/lib/mass-save-pdf-fill";
import type { MassSaveMarkKey } from "@/lib/mass-save-form-map";

type StoredEquipmentRow = {
  install_date: string | null;
  ahri_reference: string | null;
  cooling_capacity_btu: string | null;
  tons: string | null;
  area_served: string | null;
};

type StoredLineItems = {
  sponsor: {
    electric: string | null;
    electric_account_number: string | null;
    gas: string | null;
    gas_account_number: string | null;
  };
  project: {
    occupancy: string | null;
    assessment_site_id: string | null;
    housing_type: string | null;
    total_square_footage: string | null;
    multi_unit_count: string | null;
    pre_existing_heating: string | null;
    rebate_types: string[];
  };
  integrated_control: {
    model: string | null;
    switchover_temp: string | null;
    count: string | null;
    location: string | null;
  };
  installer: {
    company_name: string;
    hpin_company_id: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  payee: string | null;
  equipment: StoredEquipmentRow[];
};

const ELECTRIC_MARK: Record<string, MassSaveMarkKey> = {
  cape_light_compact: "electricCapeLightCompact",
  eversource: "electricEversource",
  national_grid: "electricNationalGrid",
  unitil: "electricUnitil",
  other: "electricOther",
};

const GAS_MARK: Record<string, MassSaveMarkKey> = {
  berkshire_gas: "gasBerkshireGas",
  eversource: "gasEversource",
  liberty: "gasLiberty",
  national_grid: "gasNationalGrid",
  unitil: "gasUnitil",
};

const PAYEE_MARK: Record<string, MassSaveMarkKey> = {
  installer: "payeeInstaller",
  other: "payeeOther",
};

const OCCUPANCY_MARK: Record<string, MassSaveMarkKey> = {
  owner: "ownerOccupied",
  renter: "renterOccupied",
};

const HOUSING_MARK: Record<string, MassSaveMarkKey> = {
  single_family: "housingSingleFamily",
  "2_4_unit": "housing2to4Unit",
  "5_plus_unit": "housing5PlusUnit",
};

const MULTI_UNIT_MARK: Record<string, MassSaveMarkKey> = {
  "1": "multiUnit1",
  "2": "multiUnit2",
  "3": "multiUnit3",
  "4": "multiUnit4",
};

const HEATING_MARK: Record<string, MassSaveMarkKey> = {
  oil: "heatingOil",
  propane: "heatingPropane",
  electric_resistance: "heatingElectricResistance",
  natural_gas: "heatingNaturalGas",
};

const REBATE_TYPE_MARK: Record<string, MassSaveMarkKey> = {
  whole_home: "rebateWholeHome",
  partial_home: "rebatePartialHome",
  weatherization_bonus: "rebateWeatherizationBonus",
  sizing_bonus: "rebateSizingBonus",
};

// properties.address is a single free-text field — best-effort split into
// street/city/state/zip for the form's separate boxes. Left editable in the
// output PDF (not flattened) specifically so a bad split is easy to fix.
function splitAddress(address: string | null): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  if (!address) return { street: "", city: "", state: "", zip: "" };
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    const stateZip = parts[2].split(/\s+/);
    return {
      street: parts[0],
      city: parts[1],
      state: stateZip[0] ?? "",
      zip: stateZip.slice(1).join(" "),
    };
  }
  return { street: address, city: "", state: "", zip: "" };
}

export async function getMassSaveRebateFillData(id: string): Promise<{
  data: MassSaveFillInput | null;
  docNumber: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email, phone), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return { data: null, docNumber: null, error: error?.message ?? "Rebate application not found" };
  }

  const line = doc.line_items as StoredLineItems;
  const installAddr = splitAddress(doc.properties?.address ?? null);
  const installerAddr = line.installer.address
    ? { street: line.installer.address, city: line.installer.city ?? "", state: line.installer.state ?? "", zip: line.installer.zip ?? "" }
    : splitAddress(null);

  const marks: MassSaveMarkKey[] = [];
  if (line.sponsor.electric && ELECTRIC_MARK[line.sponsor.electric]) marks.push(ELECTRIC_MARK[line.sponsor.electric]);
  if (line.sponsor.gas && GAS_MARK[line.sponsor.gas]) marks.push(GAS_MARK[line.sponsor.gas]);
  if (line.payee && PAYEE_MARK[line.payee]) marks.push(PAYEE_MARK[line.payee]);
  if (line.project.occupancy && OCCUPANCY_MARK[line.project.occupancy]) marks.push(OCCUPANCY_MARK[line.project.occupancy]);
  if (line.project.housing_type && HOUSING_MARK[line.project.housing_type]) marks.push(HOUSING_MARK[line.project.housing_type]);
  if (line.project.multi_unit_count && MULTI_UNIT_MARK[line.project.multi_unit_count])
    marks.push(MULTI_UNIT_MARK[line.project.multi_unit_count]);
  if (line.project.pre_existing_heating && HEATING_MARK[line.project.pre_existing_heating])
    marks.push(HEATING_MARK[line.project.pre_existing_heating]);
  for (const t of line.project.rebate_types ?? []) {
    if (REBATE_TYPE_MARK[t]) marks.push(REBATE_TYPE_MARK[t]);
  }

  const eq = line.equipment ?? [];

  return {
    data: {
      text: {
        accountHolderName: doc.customers?.name ?? "",
        accountHolderPhone: doc.customers?.phone ?? "",
        accountHolderEmail: doc.customers?.email ?? "",
        installationAddress: installAddr.street,
        installationCity: installAddr.city,
        installationState: installAddr.state,
        installationZip: installAddr.zip,
        electricAccountNumber: line.sponsor.electric_account_number ?? "",
        gasAccountNumber: line.sponsor.gas_account_number ?? "",
        installerCompanyName: line.installer.company_name,
        installerHpinId: line.installer.hpin_company_id ?? "",
        installerContactPerson: line.installer.contact_person ?? "",
        installerPhone: line.installer.phone ?? "",
        installerEmail: line.installer.email ?? "",
        installerAddress: installerAddr.street,
        installerCity: installerAddr.city,
        installerState: installerAddr.state,
        installerZip: installerAddr.zip,
        assessmentSiteId: line.project.assessment_site_id ?? "",
        totalSquareFootage: line.project.total_square_footage ?? "",
        icModel: line.integrated_control.model ?? "",
        icSwitchoverTemp: line.integrated_control.switchover_temp ?? "",
        icCount: line.integrated_control.count ?? "",
        icLocation: line.integrated_control.location ?? "",
        eq1InstallDate: eq[0]?.install_date ?? "",
        eq1Ahri: eq[0]?.ahri_reference ?? "",
        eq1Btu: eq[0]?.cooling_capacity_btu ?? "",
        eq1Tons: eq[0]?.tons ?? "",
        eq1Area: eq[0]?.area_served ?? "",
        eq2InstallDate: eq[1]?.install_date ?? "",
        eq2Ahri: eq[1]?.ahri_reference ?? "",
        eq2Btu: eq[1]?.cooling_capacity_btu ?? "",
        eq2Tons: eq[1]?.tons ?? "",
        eq2Area: eq[1]?.area_served ?? "",
        eq3InstallDate: eq[2]?.install_date ?? "",
        eq3Ahri: eq[2]?.ahri_reference ?? "",
        eq3Btu: eq[2]?.cooling_capacity_btu ?? "",
        eq3Tons: eq[2]?.tons ?? "",
        eq3Area: eq[2]?.area_served ?? "",
      },
      marks,
    },
    docNumber: doc.doc_number,
    error: null,
  };
}
