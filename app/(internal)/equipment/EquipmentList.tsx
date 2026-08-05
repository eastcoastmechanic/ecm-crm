"use client";

import { useMemo, useState } from "react";
import { deleteEquipment, updateEquipment } from "./actions";
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

function EditEquipmentForm({
  item,
  properties,
  onDone,
}: {
  item: Equipment;
  properties: Property[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (formData) => {
        await updateEquipment(formData);
        onDone();
      }}
      className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={item.id} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property
        <select name="property_id" defaultValue={item.property_id ?? ""} className={inputClass}>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Type
        <input name="type" required defaultValue={item.type} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Brand
        <input name="brand" defaultValue={item.brand ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Model
        <input name="model" defaultValue={item.model ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Serial number
        <input name="serial_number" defaultValue={item.serial_number ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Install date
        <input
          name="install_date"
          type="date"
          defaultValue={item.install_date ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Warranty expiration
        <input
          name="warranty_expiration"
          type="date"
          defaultValue={item.warranty_expiration ?? ""}
          className={inputClass}
        />
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

export default function EquipmentList({
  equipment,
  properties,
}: {
  equipment: Equipment[];
  properties: Property[];
}) {
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleDelete(item: Equipment) {
    const label = [item.type, item.brand, item.model].filter(Boolean).join(" ");
    if (
      !window.confirm(`Delete "${label}"? This also permanently deletes its diagnostic history. This cannot be undone.`)
    )
      return;

    setErrors((prev) => ({ ...prev, [item.id]: "" }));
    setDeletingId(item.id);
    try {
      const result = await deleteEquipment(item.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [item.id]: result.error! }));
      }
    } finally {
      setDeletingId(null);
    }
  }

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
          aria-label="Search equipment"
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
        {filtered.map((item) =>
          editingId === item.id ? (
            <div key={item.id} className="py-3">
              <EditEquipmentForm item={item} properties={properties} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={item.id} className="flex items-start justify-between gap-3 py-3">
              <div>
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
                {errors[item.id] && <p className={`mt-1 ${errorClass}`}>{errors[item.id]}</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(item.id)}
                  className={`${buttonSecondaryClass} !px-2 !py-1`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={deletingId === item.id}
                  title="Delete equipment"
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
