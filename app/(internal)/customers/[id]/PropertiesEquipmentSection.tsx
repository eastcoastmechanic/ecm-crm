"use client";

import { useState } from "react";
import { deleteProperty, updateProperty } from "../../properties/actions";
import { deleteEquipment, updateEquipment } from "../../equipment/actions";
import SubmitButton from "../../SubmitButton";
import {
  buttonClass,
  buttonSecondaryClass,
  errorClass,
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../../ui";

type Property = {
  id: string;
  address: string;
  property_type: string | null;
};

type Equipment = {
  id: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  property_id: string;
};

function EditPropertyForm({
  property,
  customerId,
  onDone,
}: {
  property: Property;
  customerId: string;
  onDone: () => void;
}) {
  return (
    <form
      action={async (formData) => {
        await updateProperty(formData);
        onDone();
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={property.id} />
      <input type="hidden" name="customer_id" value={customerId} />
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
      className="grid gap-2 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={item.id} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property
        <select name="property_id" defaultValue={item.property_id} className={inputClass}>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Type
        <input name="type" required defaultValue={item.type ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Brand
        <input name="brand" defaultValue={item.brand ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Model
        <input name="model" defaultValue={item.model ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Serial number
        <input name="serial_number" defaultValue={item.serial_number ?? ""} className={inputClass} />
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

export default function PropertiesEquipmentSection({
  customerId,
  properties,
  equipmentByProperty,
}: {
  customerId: string;
  properties: Property[];
  equipmentByProperty: Record<string, Equipment[]>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleDeleteProperty(property: Property) {
    if (
      !window.confirm(
        `Delete "${property.address}"? This also permanently deletes its equipment, jobs, documents, and service history. This cannot be undone.`
      )
    )
      return;

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

  async function handleDeleteEquipment(item: Equipment) {
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Properties &amp; Equipment</h2>
      {properties.length === 0 && <p className={subTextClass}>No properties on file.</p>}
      <div className="flex flex-col gap-3">
        {properties.map((property) => (
          <div key={property.id} className="rounded-xl border border-white/8 p-4">
            {editingPropertyId === property.id ? (
              <EditPropertyForm
                property={property}
                customerId={customerId}
                onDone={() => setEditingPropertyId(null)}
              />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={itemTitleClass}>{property.address}</div>
                  {property.property_type && <div className={itemSubClass}>{property.property_type}</div>}
                  {errors[property.id] && <p className={`mt-1 ${errorClass}`}>{errors[property.id]}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPropertyId(property.id)}
                    className={`${buttonSecondaryClass} !px-2 !py-1`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProperty(property)}
                    disabled={deletingId === property.id}
                    title="Delete property"
                    className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {(equipmentByProperty[property.id] ?? []).map((item) =>
                editingEquipmentId === item.id ? (
                  <div key={item.id} className="rounded-lg border border-white/8 bg-white/3 p-3">
                    <EditEquipmentForm
                      item={item}
                      properties={properties}
                      onDone={() => setEditingEquipmentId(null)}
                    />
                  </div>
                ) : (
                  <div key={item.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className={itemSubClass}>
                        {item.type}
                        {item.brand ? ` — ${item.brand}` : ""}
                        {item.model ? ` ${item.model}` : ""}
                        {item.serial_number ? ` (S/N ${item.serial_number})` : ""}
                      </div>
                      {errors[item.id] && <p className={errorClass}>{errors[item.id]}</p>}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingEquipmentId(item.id)}
                        className={`${buttonSecondaryClass} !px-2 !py-0.5 !text-[10px]`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEquipment(item)}
                        disabled={deletingId === item.id}
                        title="Delete equipment"
                        className="rounded-lg p-1 text-sm opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )
              )}
              {(equipmentByProperty[property.id] ?? []).length === 0 && (
                <div className={itemSubClass}>No equipment on file.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
