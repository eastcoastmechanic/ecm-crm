import { PT_TABLES, REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { headingClass, subTextClass } from "../../ui";

export default function PtChartsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>PT Charts</h1>
        <p className={subTextClass}>Pressure (PSIG) → saturation temperature (°F) reference tables.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {REFRIGERANT_TYPES.map((refrigerant) => (
          <div key={refrigerant} className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h2 className="mb-2 font-display text-sm font-bold">{refrigerant}</h2>
            <div className="overflow-y-auto max-h-96">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
                    <th className="px-2 py-1">PSIG</th>
                    <th className="px-2 py-1">°F</th>
                  </tr>
                </thead>
                <tbody>
                  {PT_TABLES[refrigerant].map(([psig, temp]) => (
                    <tr key={psig} className="border-b border-white/6 last:border-0">
                      <td className="px-2 py-0.5 text-white">{psig}</td>
                      <td className="px-2 py-0.5 text-white">{temp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
