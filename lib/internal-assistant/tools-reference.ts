import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  PT_TABLES,
  REFRIGERANT_TYPES,
  saturationTempF,
  computeSuperheat,
  computeSubcooling,
  type RefrigerantType,
} from "@/lib/refrigerant";
import { HVAC_DIAGNOSTIC_REFERENCE } from "@/lib/hvac-reference";

/**
 * Field reference: PT charts, superheat/subcooling, and ECM's own diagnostic
 * guide.
 *
 * All three already existed but only as Tech Hub pages a tech had to stop and
 * read. Exposing them as tools means the assistant answers from ECM's own
 * numbers instead of the model's general knowledge — which matters, because
 * "normal superheat" depends on whether it's a TXV or fixed-orifice system and
 * the guide says so explicitly.
 *
 * The maths is delegated to lib/refrigerant.ts rather than reimplemented: it
 * interpolates between PT table entries, and a second implementation that
 * rounded differently would quietly disagree with the diagnostics form.
 */

const REFRIGERANTS = REFRIGERANT_TYPES as [RefrigerantType, ...RefrigerantType[]];

const ptChartTool = betaZodTool({
  name: "lookup_saturation_temp",
  description:
    "Look up saturation temperature for a refrigerant at a given pressure, from ECM's PT charts. Use for 'what's the sat temp for 410A at 118 psi'. Interpolates between table points.",
  inputSchema: z.object({
    refrigerant: z.enum(REFRIGERANTS),
    psig: z.number().describe("Gauge pressure in PSIG"),
  }),
  run: async ({ refrigerant, psig }) => {
    const satTemp = saturationTempF(refrigerant, psig);
    if (satTemp === null) return `No PT data for ${refrigerant} at ${psig} PSIG.`;

    const table = PT_TABLES[refrigerant];
    const [minP] = table[0];
    const [maxP] = table[table.length - 1];
    const clamped = psig < minP || psig > maxP;

    return [
      `${refrigerant} at ${psig} PSIG → saturation temp ${satTemp}°F`,
      clamped
        ? `Note: ${psig} PSIG is outside the charted range (${minP}–${maxP} PSIG), so this is the nearest table value, not interpolated. Treat it as approximate.`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  },
});

const superheatSubcoolTool = betaZodTool({
  name: "calculate_superheat_subcooling",
  description:
    "Calculate superheat and/or subcooling from gauge readings, and interpret them against ECM's field guide. Give whichever pairs you have — suction pressure + suction line temp for superheat, liquid pressure + liquid line temp for subcooling. Use this whenever a tech reads numbers off a manifold or probes.",
  inputSchema: z.object({
    refrigerant: z.enum(REFRIGERANTS),
    suctionPressure: z.number().optional().describe("PSIG"),
    suctionLineTemp: z.number().optional().describe("°F, measured at the suction line"),
    liquidPressure: z.number().optional().describe("PSIG"),
    liquidLineTemp: z.number().optional().describe("°F, measured at the liquid service valve"),
    meteringDevice: z.enum(["txv", "fixed_orifice", "unknown"]).optional(),
    returnAirTemp: z.number().optional().describe("°F"),
    supplyAirTemp: z.number().optional().describe("°F"),
  }),
  run: async ({
    refrigerant,
    suctionPressure,
    suctionLineTemp,
    liquidPressure,
    liquidLineTemp,
    meteringDevice,
    returnAirTemp,
    supplyAirTemp,
  }) => {
    const lines: string[] = [`Refrigerant: ${refrigerant}`];

    const superheat = computeSuperheat(refrigerant, suctionPressure ?? null, suctionLineTemp ?? null);
    if (superheat !== null) {
      const satSuction = saturationTempF(refrigerant, suctionPressure!);
      lines.push(
        `Superheat: ${superheat}°F  (suction ${suctionPressure} PSIG → sat ${satSuction}°F, line ${suctionLineTemp}°F)`
      );
    } else if (suctionPressure !== undefined || suctionLineTemp !== undefined) {
      lines.push("Superheat: need BOTH suction pressure and suction line temp.");
    }

    const subcooling = computeSubcooling(refrigerant, liquidPressure ?? null, liquidLineTemp ?? null);
    if (subcooling !== null) {
      const satLiquid = saturationTempF(refrigerant, liquidPressure!);
      lines.push(
        `Subcooling: ${subcooling}°F  (liquid ${liquidPressure} PSIG → sat ${satLiquid}°F, line ${liquidLineTemp}°F)`
      );
    } else if (liquidPressure !== undefined || liquidLineTemp !== undefined) {
      lines.push("Subcooling: need BOTH liquid pressure and liquid line temp.");
    }

    if (returnAirTemp !== undefined && supplyAirTemp !== undefined) {
      const split = Math.round((returnAirTemp - supplyAirTemp) * 10) / 10;
      lines.push(`Temp split: ${split}°F  (return ${returnAirTemp}°F − supply ${supplyAirTemp}°F)`);
    }

    if (superheat === null && subcooling === null) {
      return "No complete reading pair given. Superheat needs suction pressure + suction line temp; subcooling needs liquid pressure + liquid line temp.";
    }

    if (meteringDevice) lines.push(`Metering device: ${meteringDevice}`);
    lines.push(
      "",
      "Interpret these against the ranges below — note the normal superheat band differs for TXV vs fixed-orifice, so say which you assumed if the tech didn't specify.",
      "",
      HVAC_DIAGNOSTIC_REFERENCE
    );

    return lines.join("\n");
  },
});

const diagnosticGuideTool = betaZodTool({
  name: "hvac_diagnostic_guide",
  description:
    "ECM's own field diagnostic guide — superheat and subcooling ranges with the action for each band, symptom-to-cause scenarios, and target temp split. Use when reasoning about a diagnosis, or when the tech asks what a reading means. Prefer this over general knowledge; these are the numbers ECM works to.",
  inputSchema: z.object({
    topic: z
      .enum(["all", "superheat", "subcooling", "scenarios", "temp_split"])
      .optional()
      .describe("Defaults to all"),
  }),
  run: async ({ topic }) => {
    if (!topic || topic === "all") return HVAC_DIAGNOSTIC_REFERENCE;

    const headings: Record<string, string> = {
      superheat: "SUPERHEAT GUIDE",
      subcooling: "SUBCOOLING GUIDE",
      scenarios: "COMMON DIAGNOSTIC SCENARIOS",
      temp_split: "TEMP SPLIT",
    };
    const marker = headings[topic];
    const blocks = HVAC_DIAGNOSTIC_REFERENCE.split(/\n\n+/);
    const block = blocks.find((b) => b.startsWith(marker));
    // Fall back to the whole guide rather than returning nothing if the
    // reference text is reworded later and a heading stops matching.
    return block ?? HVAC_DIAGNOSTIC_REFERENCE;
  },
});

export const referenceTools = [ptChartTool, superheatSubcoolTool, diagnosticGuideTool];
