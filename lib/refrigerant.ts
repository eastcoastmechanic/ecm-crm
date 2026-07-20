// Pressure/temperature saturation tables, ported from ECM's field app
// (ECM_Field_App.html, PT Charts tab). Each entry is [psig, saturation °F].
// Used to compute superheat/subcooling from field readings.

export type RefrigerantType = "R-410A" | "R-22" | "R-32" | "R-454B";

const PT_TABLES: Record<RefrigerantType, [number, number][]> = {
  "R-410A": [
    [50, -23], [60, -16], [70, -10], [80, -4], [90, 2], [100, 7], [110, 12],
    [120, 17], [130, 22], [140, 26], [150, 30], [160, 34], [170, 37], [180, 41],
    [200, 48], [220, 54], [240, 60], [260, 65], [280, 71], [300, 76], [320, 80],
    [340, 84], [360, 88], [380, 92], [400, 95], [420, 99], [440, 102], [460, 106],
    [480, 109], [500, 112],
  ],
  "R-22": [
    [20, -15], [30, -7], [40, 1], [50, 8], [60, 14], [70, 20], [80, 26], [90, 31],
    [100, 36], [110, 40], [120, 44], [130, 48], [140, 52], [150, 56], [160, 60],
    [170, 63], [180, 66], [190, 69], [200, 72], [210, 75], [220, 77], [230, 80],
    [240, 82], [250, 84], [260, 87], [270, 89], [280, 91], [300, 95], [320, 99],
    [340, 103],
  ],
  "R-32": [
    [60, -25], [80, -13], [100, -3], [120, 6], [140, 14], [160, 20], [180, 26],
    [200, 32], [220, 37], [240, 42], [260, 46], [280, 50], [300, 54], [320, 58],
    [340, 62], [360, 65], [380, 68], [400, 71], [420, 74], [440, 77], [460, 80],
    [480, 83], [500, 86], [520, 88], [540, 91], [560, 93],
  ],
  "R-454B": [
    [60, -21], [80, -10], [100, 0], [120, 8], [140, 15], [160, 21], [180, 27],
    [200, 33], [220, 38], [240, 43], [260, 47], [280, 51], [300, 55], [320, 59],
    [340, 63], [360, 66], [380, 69], [400, 72], [420, 75], [440, 78], [460, 81],
    [480, 83], [500, 86],
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
