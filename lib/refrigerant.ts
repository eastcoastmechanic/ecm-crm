// Pressure/temperature saturation tables, ported from ECM's field app
// (ECM_Field_App.html, PT Charts tab). Each entry is [psig, saturation °F].
// Used to compute superheat/subcooling from field readings.

export type RefrigerantType = "R-410A" | "R-22" | "R-32" | "R-454B";

// Saturation pressure/temperature tables, [psig, °F].
//
// Rebuilt 2026-08-09 from published saturation data after the previous tables
// were found to read 20-30°F LOW across all four refrigerants. Verified
// against a real gauge: R-410A at 118 PSIG is 39.84°F measured, 39.7°F here;
// the old table interpolated to ~16°F.
//
// That error was not cosmetic. Superheat = line temp - sat temp, so a low sat
// temp inflates superheat; subcooling = sat temp - line temp, so it deflates
// subcooling. Both push the same way -- toward 'add refrigerant' -- which is
// how a healthy system gets overcharged on advice from its own tooling.
//
// Single table per refrigerant, used for both superheat (dew) and subcooling
// (bubble). Fine for R-22/R-32/R-410A; R-454B glides ~2-3°F between bubble and
// dew, so its subcooling runs marginally optimistic.
export const PT_TABLES: Record<RefrigerantType, [number, number][]> = {
  "R-410A": [
    [50, 1.7], [60, 8.6], [70, 14.7], [80, 20.6], [90, 25.6], [100, 30.7], [110, 35.7],
    [120, 40.6], [130, 44.6], [140, 48.6], [150, 52.4], [160, 56.1], [170, 59.7], [180, 63.1],
    [190, 66.4], [200, 69.7], [220, 75.6], [240, 81.3], [260, 86.6], [280, 91.8], [300, 96.6],
    [320, 101.3], [340, 105.7], [360, 110], [380, 114], [400, 118], [420, 121.8], [440, 125.4],
    [460, 129], [480, 132.4], [500, 135.7],
  ],
  "R-22": [
    [20, -5.3], [30, 6.8], [40, 17.1], [50, 25.9], [60, 33.8], [70, 41], [80, 47.4],
    [90, 53.2], [100, 58.6], [110, 63.6], [120, 68.4], [130, 72.8], [140, 77], [150, 81.1],
    [160, 84.9], [170, 88.6], [180, 92.8], [190, 97.3], [200, 101.3], [220, 107.9], [240, 114.1],
    [260, 120], [280, 125.4], [300, 130.8], [320, 135.7], [340, 140.6],
  ],
  "R-32": [
    [40, 4.4], [50, 12], [60, 18.7], [70, 24.5], [80, 30.1], [90, 34.9], [100, 39.7],
    [110, 43.9], [120, 48], [130, 51.9], [140, 55.4], [150, 59], [160, 62.2], [170, 65.3],
    [180, 68.3], [190, 71.2], [200, 73.9], [220, 79.3], [240, 84], [260, 88.7], [280, 93],
    [300, 97.1], [320, 101.1], [340, 104.7], [360, 108.4], [380, 111.8], [400, 115], [420, 118.3],
    [440, 121.3], [460, 124.2], [480, 127.1], [500, 129.9], [520, 132.5], [540, 135.1], [560, 137.7],
  ],
  "R-454B": [
    [50, 4], [60, 11.1], [70, 17.3], [80, 23], [90, 28.4], [100, 33.2], [110, 37.8],
    [120, 42.1], [130, 46.1], [140, 50.1], [150, 53.7], [160, 57.3], [170, 60.7], [180, 63.9],
    [190, 67], [200, 70.1], [220, 75.7], [240, 81.1], [260, 86], [280, 90.9], [300, 95.3],
    [320, 99.7], [340, 103.7], [360, 107.7], [380, 111.5], [400, 115.1], [420, 118.7], [440, 122.1],
    [460, 125.3], [480, 128.5], [500, 131.6],
  ],
};

export const REFRIGERANT_TYPES = Object.keys(PT_TABLES) as RefrigerantType[];

/** Linear interpolation of saturation temp (°F) from pressure (psig). Clamps to table ends. */
export function saturationTempF(refrigerant: RefrigerantType, psig: number): number | null {
  const table = PT_TABLES[refrigerant];
  if (!table || !Number.isFinite(psig)) return null;

  if (psig <= table[0][0]) return table[0][1];
  if (psig >= table[table.length - 1][0]) return table[table.length - 1][1];

  for (let i = 0; i < table.length - 1; i++) {
    const [p1, t1] = table[i];
    const [p2, t2] = table[i + 1];
    if (psig >= p1 && psig <= p2) {
      const ratio = (psig - p1) / (p2 - p1);
      return Math.round((t1 + ratio * (t2 - t1)) * 10) / 10;
    }
  }
  return null;
}

export function computeSuperheat(
  refrigerant: RefrigerantType,
  suctionPressure: number | null,
  suctionLineTemp: number | null
): number | null {
  if (suctionPressure === null || suctionLineTemp === null) return null;
  const satTemp = saturationTempF(refrigerant, suctionPressure);
  if (satTemp === null) return null;
  return Math.round((suctionLineTemp - satTemp) * 10) / 10;
}

export function computeSubcooling(
  refrigerant: RefrigerantType,
  liquidPressure: number | null,
  liquidLineTemp: number | null
): number | null {
  if (liquidPressure === null || liquidLineTemp === null) return null;
  const satTemp = saturationTempF(refrigerant, liquidPressure);
  if (satTemp === null) return null;
  return Math.round((satTemp - liquidLineTemp) * 10) / 10;
}
