"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { deleteCustomer } from "./actions";
import { errorClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  async function handleDelete(customer: Customer) {
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return;

    setErrors((prev) => ({ ...prev, [customer.id]: "" }));
    setDeletingId(customer.id);
    try {
      const result = await deleteCustomer(customer.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [customer.id]: result.error! }));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Search customers…"
          aria-label="Search customers"
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
          <div key={customer.id} className="flex items-center gap-2 py-3">
            <Link href={`/customers/${customer.id}`} className="min-w-0 flex-1 hover:opacity-80">
              <div className={itemTitleClass}>{customer.name}</div>
              <div className={itemSubClass}>
                {[customer.email, customer.phone].filter(Boolean).join(" · ")}
              </div>
              {customer.billing_address && (
                <div className={itemSubClass}>{customer.billing_address}</div>
              )}
              {errors[customer.id] && <p className={`mt-1 ${errorClass}`}>{errors[customer.id]}</p>}
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(customer)}
              disabled={deletingId === customer.id}
              title="Delete customer"
              className="flex-shrink-0 rounded-lg p-2 text-lg opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
