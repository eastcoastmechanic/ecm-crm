// Diagnostic heuristics ported from ECM's field app (ECM_Field_App.html,
// Knowledge Base tab) — used as grounding context in the diagnosis prompt
// so Claude reasons from ECM's own field guide, not generic knowledge.

export const HVAC_DIAGNOSTIC_REFERENCE = `SUPERHEAT GUIDE (cooling mode). SH = Suction Line Temp - Saturated Suction Temp.
<3F DANGER: liquid slugging compressor -> recover charge immediately
3-5F CRITICAL LOW: flooding metering device / overcharge -> recover charge, check TXV
5-8F LOW: overcharge or dirty filter -> reduce charge, check airflow
8-14F NORMAL (TXV systems): operating correctly
10-25F NORMAL (fixed-orifice systems): operating correctly
14-20F HIGH: low charge or restriction -> check charge, check filter drier
20-30F UNDERCHARGE: low refrigerant / restriction -> check for leaks, add charge
>30F SEVERE: major leak or blocked metering device -> shutdown, find leak

SUBCOOLING GUIDE. SC = Saturated Liquid Temp - Liquid Line Temp (measured at liquid service valve).
<2F FLASH GAS: liquid flashing before metering device -> add charge, check drier
2-5F VERY LOW: undercharge -> add refrigerant charge
5-10F LOW: low charge -> check for leak, add charge
10-18F NORMAL: operating correctly
18-22F HIGH: overcharge or condenser issue -> recover some charge
22-28F OVERCHARGE: excess refrigerant -> recover refrigerant to spec
>28F SEVERE: major overcharge or failed condenser -> recover charge, inspect condenser

COMMON DIAGNOSTIC SCENARIOS (symptom -> SH -> SC -> likely cause -> action):
Not cooling, warm air -> SH high, SC low -> low charge / leak -> leak check, add charge
Not cooling, ices up -> SH low, SC high -> low airflow -> check filter, blower, coil
Short cycling, high pressure -> SH low, SC high -> overcharge -> recover refrigerant
High discharge temp -> SH high, SC low -> low charge -> add charge, check for leak
Liquid slugging noise -> SH very low, SC high -> TXV flooding / overcharge -> check TXV, recover charge
Suction line frosting -> SH low, SC normal -> low airflow / dirty coil -> clean coil, check airflow
High SH and high SC -> restriction in liquid line -> check filter drier, TXV
Normal SH, low SC -> slight undercharge -> small charge addition
Noise from compressor -> SH low, SC high -> liquid flood back -> recover charge, check TXV

TEMP SPLIT (cooling): Return Air Temp - Supply Air Temp. Target 16-22F. <14F suggests low airflow; >24F suggests very high split (check airflow/load or overcharge).`;
