"use client";

import { useMemo, useState } from "react";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
};

type Property = {
  id: string;
  address: string;
  customer_id: string | null;
};

export default function CustomerList({
  customers,
  properties,
}: {
  customers: Customer[];
  properties: Property[];
}) {
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("");

  const filtered = useMemo(() => {
    const customerIdForProperty = properties.find((p) => p.id === propertyId)?.customer_id;
    const query = search.trim().toLowerCase();

    return customers.filter((customer) => {
      if (propertyId && customer.id !== customerIdForProperty) return false;
      if (!query) return true;
      return [customer.name, customer.email, customer.phone, customer.billing_address]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  }, [customers, properties, propertyId, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Search customers…"
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
          <p className={subTextClass}>No customers match.</p>
        )}
        {filtered.map((customer) => (
          <div key={customer.id} className="py-3">
            <div className={itemTitleClass}>{customer.name}</div>
            <div className={itemSubClass}>
              {[customer.email, customer.phone].filter(Boolean).join(" · ")}
            </div>
            {customer.billing_address && (
              <div className={itemSubClass}>{customer.billing_address}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
