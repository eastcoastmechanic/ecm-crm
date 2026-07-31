// Typical expected service life by equipment type, used to ground the AI's
// estimated-remaining-life figure in a condition assessment instead of it
// guessing from nothing. General industry figures, not manufacturer specs.

export const EQUIPMENT_LIFESPAN_REFERENCE = `TYPICAL EXPECTED SERVICE LIFE BY EQUIPMENT TYPE (general industry figures):
Central AC condenser / heat pump (outdoor unit): 12-17 years
Furnace (gas/oil forced air): 15-20 years
Boiler (gas/oil hydronic): 15-30 years
Mini-split / ductless heat pump: 15-20 years
Tank water heater: 8-12 years
Tankless water heater: 18-22 years
Air handler / indoor coil: 15-20 years

Use these as a baseline, adjusted for the equipment's actual age, observed condition, and any readings/symptoms noted. Equipment well past its typical range that's still running fine should get a shorter remaining-life estimate and a "monitor" or "replace" recommendation as appropriate; equipment within range with no issues can get "no_action".`;
