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
    [40, -7.8], [50, 0.3], [60, 7.5], [70, 14], [80, 19.9], [90, 25.4], [100, 30.4],
    [110, 35.1], [120, 39.6], [130, 43.8], [140, 47.8], [150, 51.6], [160, 55.2], [170, 58.6],
    [180, 62], [190, 65.2], [200, 68.3], [220, 74.1], [240, 79.6], [260, 84.8], [280, 89.7],
    [300, 94.3], [320, 98.8], [340, 103.1], [360, 107.1], [380, 111.1], [400, 114.8], [420, 118.5],
    [440, 122], [460, 125.4], [480, 128.8], [500, 132], [520, 135.1], [540, 138.1], [560, 141.1],
  ],
  "R-454B": [
    [50, 5.7], [60, 13.1], [70, 19.7], [80, 25.8], [90, 31.4], [100, 36.6], [110, 41.4],
    [120, 46], [130, 50.3], [140, 54.4], [150, 58.3], [160, 62], [170, 65.5], [180, 68.9],
    [190, 72.2], [200, 75.4], [220, 81.4], [240, 87], [260, 92.4], [280, 97.4], [300, 102.2],
    [320, 106.8], [340, 111.1], [360, 115.3], [380, 119.4], [400, 123.3], [420, 127], [440, 130.7],
    [460, 134.2], [480, 137.6], [500, 140.9],
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
