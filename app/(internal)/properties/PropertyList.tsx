"use client";

import { useMemo, useState } from "react";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

type Property = {
  id: string;
  address: string;
  property_type: string | null;
  customer_id: string | null;
  customers: { name: string } | null;
};

type Customer = {
  id: string;
  name: string;
};

export default function PropertyList({
  properties,
  customers,
}: {
  properties: Property[];
  customers: Customer[];
}) {
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return properties.filter((property) => {
      if (customerId && property.customer_id !== customerId) return false;
      if (!query) return true;
      return [property.address, property.property_type, property.customers?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  }, [properties, customerId, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Search properties…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className={inputClass}
        >
          <option value="">All customers</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && (
          <p className={subTextClass}>No properties match.</p>
        )}
        {filtered.map((property) => (
          <div key={property.id} className="py-3">
            <div className={itemTitleClass}>{property.address}</div>
            <div className={itemSubClass}>
              {property.customers?.name}
              {property.property_type ? ` · ${property.property_type}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
