function formatICSDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeICS(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function generateJobICS(params: {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//East Coast Mechanical//ECM CRM//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.uid}@ecm-crm`,
    `SEQUENCE:${params.sequence}`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(params.start)}`,
    `DTEND:${formatICSDate(params.end)}`,
    `SUMMARY:${escapeICS(params.summary)}`,
    params.location ? `LOCATION:${escapeICS(params.location)}` : null,
    params.description ? `DESCRIPTION:${escapeICS(params.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return lines.join("\r\n");
}
