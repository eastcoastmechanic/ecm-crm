"use client";

import DeleteRecordButton from "../DeleteRecordButton";
import { deleteDocument } from "./actions";

export default function DocumentDeleteButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  return (
    <DeleteRecordButton
      label={`Delete ${label}`}
      confirmMessage={`Delete this ${label.toLowerCase()}? Linked jobs stay in the book — they just lose the pointer to this document. This cannot be undone.`}
      onDelete={() => deleteDocument(id)}
      redirectTo="/documents"
    />
  );
}
