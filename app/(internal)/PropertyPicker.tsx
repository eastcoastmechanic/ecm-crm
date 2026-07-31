"use client";

import { inputClass } from "./ui";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "./intake-constants";

type Property = { id: string; address: string; customer_id: string | null };

export default function PropertyPicker({
  properties,
  customerId,
  value,
  onChange,
  required = true,
}: {
  properties: Property[];
  customerId: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const filtered =
    customerId && customerId !== NEW_CUSTOMER_VALUE
      ? properties.filter((p) => p.customer_id === customerId)
      : [];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property
        <select
          name="property_id"
          required={required}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Select property
          </option>
          <option value={NEW_PROPERTY_VALUE}>+ Add new property</option>
          {filtered.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
            </option>
          ))}
        </select>
      </label>

      {value === NEW_PROPERTY_VALUE && (
        <label className="flex flex-col gap-1 text-xs text-g300">
          Property address
          <input name="new_property_address" placeholder="Property address" required className={inputClass} />
        </label>
      )}
    </div>
  );
}
