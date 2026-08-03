import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  MASS_SAVE_TEXT_FIELDS,
  MASS_SAVE_MARKS,
  type MassSaveTextFieldKey,
  type MassSaveMarkKey,
} from "./mass-save-form-map";

export type MassSaveFillInput = {
  text: Partial<Record<MassSaveTextFieldKey, string>>;
  marks: MassSaveMarkKey[];
};

export async function fillMassSaveRebateForm(input: MassSaveFillInput): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), "public", "forms", "mass-save-ashp-2026.pdf");
  const templateBytes = await readFile(templatePath);

  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();

  for (const [key, value] of Object.entries(input.text)) {
    if (!value) continue;
    const fieldName = MASS_SAVE_TEXT_FIELDS[key as MassSaveTextFieldKey];
    try {
      form.getTextField(fieldName).setText(value);
    } catch {
      // Field missing/renamed in a template update — skip rather than fail
      // the whole document over one field.
    }
  }

  for (const key of input.marks) {
    const mark = MASS_SAVE_MARKS[key];
    if (!mark) continue;
    try {
      if (mark.widgetIndex === undefined) {
        // Field used by exactly one checkbox on this page — safe to check
        // normally.
        form.getCheckBox(mark.field).check();
      } else {
        // Field's name is reused by a second, unrelated checkbox elsewhere
        // on this same page — set only this specific widget's appearance
        // state so the other one isn't affected.
        const checkBox = form.getCheckBox(mark.field);
        const widget = checkBox.acroField.getWidgets()[mark.widgetIndex];
        widget.dict.set(PDFName.of("AS"), PDFName.of("Yes"));
      }
    } catch {
      // Skip rather than fail the whole document over one checkbox.
    }
  }

  // Deliberately not flattened: some text values (address parsing, in
  // particular) are best-effort, so leave every field editable in a real
  // PDF viewer for a final check/correction before submitting.
  return Buffer.from(await pdf.save());
}
