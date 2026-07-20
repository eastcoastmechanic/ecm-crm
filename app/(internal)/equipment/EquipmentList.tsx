"use client";

import { useMemo, useState } from "react";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

type Equipment = {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expiration: string | null;
  property_id: string | null;
  properties: { address: string; customers: { name: string } | null } | null;
};

type Property = {
  id: string;
  address: string;
};

export default function EquipmentList({
  equipment,
  properties,
}: {
  equipment: Equipment[];
  properties: Property[];
}) {
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return equipment.filter((item) => {
      if (propertyId && item.property_id !== propertyId) return false;
      if (!query) return true;
      return [item.type, item.brand, item.model, item.serial_number, item.properties?.address]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  }, [equipment, propertyId, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Search equipment…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className={inputClass}
        >
          <option value="">All properties</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && (
          <p className={subTextClass}>No equipment matches.</p>
        )}
        {filtered.map((item) => (
          <div key={item.id} className="py-3">
            <div className={itemTitleClass}>
              {item.type}
              {item.brand ? ` — ${item.brand}` : ""}
              {item.model ? ` ${item.model}` : ""}
            </div>
            <div className={itemSubClass}>
              {item.properties?.address}
              {item.properties?.customers?.name ? ` — ${item.properties.customers.name}` : ""}
            </div>
            <div className={itemSubClass}>
              {[
                item.serial_number ? `SN ${item.serial_number}` : null,
                item.install_date ? `Installed ${item.install_date}` : null,
                item.warranty_expiration ? `Warranty until ${item.warranty_expiration}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
