"use client";

import { useMemo, useState } from "react";
import { startPmChecklist } from "../actions";
import { buttonClass, errorClass, inputClass } from "../../ui";

type JobOption = {
  id: string;
  job_type: string | null;
  scheduled_at: string | null;
  property_id: string | null;
  property_type: string | null;
  label: string;
};

type EquipmentOption = {
  id: string;
  property_id: string | null;
  label: string;
};

type TemplateOption = {
  id: string;
  slug: string;
  name: string;
  audience: string;
};

export default function NewPmForm({
  jobs,
  equipment,
  templates,
  initialJobId,
}: {
  jobs: JobOption[];
  equipment: EquipmentOption[];
  templates: TemplateOption[];
  initialJobId: string | null;
}) {
  const [jobId, setJobId] = useState(initialJobId && jobs.some((job) => job.id === initialJobId) ? initialJobId : "");
  const [equipmentId, setEquipmentId] = useState("");
  const [templateTouched, setTemplateTouched] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const job = jobs.find((entry) => entry.id === jobId) ?? null;
  const equipmentChoices = useMemo(
    () => equipment.filter((item) => !job?.property_id || item.property_id === job.property_id),
    [equipment, job]
  );

  const suggestedTemplate =
    templates.find((template) => template.audience === (job?.property_type === "commercial" ? "commercial" : "residential")) ??
    templates[0];
  const selectedTemplate = templateTouched ? templateId : (suggestedTemplate?.id ?? "");

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("template_id", selectedTemplate);
    const result = await startPmChecklist(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="grid gap-3">
      <label className="flex flex-col gap-1 text-xs text-g300">
        Job
        <select
          name="job_id"
          required
          value={jobId}
          onChange={(e) => {
            setJobId(e.target.value);
            setEquipmentId("");
          }}
          className={inputClass}
        >
          <option value="">Select a job</option>
          {jobs.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Equipment
        <select
          name="equipment_id"
          required
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select equipment</option>
          {equipmentChoices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Template
        <select
          name="template_id"
          required
          value={selectedTemplate}
          onChange={(e) => {
            setTemplateTouched(true);
            setTemplateId(e.target.value);
          }}
          className={inputClass}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Technician
        <input name="tech_name" className={inputClass} autoComplete="name" />
      </label>
      {error && <p className={errorClass}>{error}</p>}
      <button type="submit" disabled={pending || templates.length === 0} className={`${buttonClass} min-h-11 w-fit`}>
        {pending ? "Starting…" : "Start checklist"}
      </button>
    </form>
  );
}
