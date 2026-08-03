"use client";

import { useMemo, useState } from "react";
import { deleteProperty, updateProperty } from "./actions";
import SubmitButton from "../SubmitButton";
import {
  buttonClass,
  buttonSecondaryClass,
  errorClass,
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../ui";

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

function EditPropertyForm({
  property,
  customers,
  onDone,
}: {
  property: Property;
  customers: Customer[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (formData) => {
        await updateProperty(formData);
        onDone();
      }}
      className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={property.id} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Customer
        <select name="customer_id" defaultValue={property.customer_id ?? ""} className={inputClass}>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property type
        <select name="property_type" defaultValue={property.property_type ?? ""} className={inputClass}>
          <option value="">Property type</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Address
        <input name="address" required defaultValue={property.address} className={inputClass} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
          Save
        </SubmitButton>
        <button type="button" onClick={onDone} className={`${subTextClass} underline`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PropertyList({
  properties,
  customers,
}: {
  properties: Property[];
  customers: Customer[];
}) {
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleDelete(property: Property) {
    if (!window.confirm(`Delete "${property.address}"? This cannot be undone.`)) return;

    setErrors((prev) => ({ ...prev, [property.id]: "" }));
    setDeletingId(property.id);
    try {
      const result = await deleteProperty(property.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [property.id]: result.error! }));
      }
    } finally {
      setDeletingId(null);
    }
  }

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
          aria-label="Search properties"
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
        {filtered.map((property) =>
          editingId === property.id ? (
            <div key={property.id} className="py-3">
              <EditPropertyForm
                property={property}
                customers={customers}
                onDone={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={property.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <div className={itemTitleClass}>{property.address}</div>
                <div className={itemSubClass}>
                  {property.customers?.name}
                  {property.property_type ? ` · ${property.property_type}` : ""}
                </div>
                {errors[property.id] && <p className={`mt-1 ${errorClass}`}>{errors[property.id]}</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(property.id)}
                  className={`${buttonSecondaryClass} !px-2 !py-1`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(property)}
                  disabled={deletingId === property.id}
                  title="Delete property"
                  className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                >
                  🗑️
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
