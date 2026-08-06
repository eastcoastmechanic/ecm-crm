"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL_FAST } from "@/lib/claude";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h));
}

const MailerSchema = z.object({
  draft_message: z.string(),
});

const SYSTEM_PROMPT = `You are a direct-mail copywriter for East Coast Mechanical (ECM), an HVAC & plumbing contractor. Write a short, warm "new to the neighborhood" mailer for a home that recently sold and is old enough that its HVAC system may need attention soon. Address it to "Current Resident" unless a specific name is given. Mention the home's approximate age in a friendly, non-alarmist way and offer a complimentary HVAC system check. Keep it brief — this is a postcard/letter, not an email.`;

export async function importMlsCsv(formData: FormData) {
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) throw new Error("Choose a CSV file to import");

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV appears to be empty");

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const addressCol = findColumn(headers, /address/);
  const cityCol = findColumn(headers, /city|town/);
  const yearBuiltCol = findColumn(headers, /year.?built/);
  const ownerCol = findColumn(headers, /owner|buyer.?name/);

  if (addressCol === -1) throw new Error('CSV must have an "address" column');
  if (yearBuiltCol === -1) throw new Error('CSV must have a "year_built" (or similar) column');

  const currentYear = new Date().getFullYear();
  const candidates: { address: string; town: string | null; fullAddress: string; ownerName: string | null; age: number }[] = [];

  for (const row of rows.slice(1)) {
    const address = row[addressCol]?.trim();
    const yearBuilt = parseInt(row[yearBuiltCol]?.trim(), 10);
    if (!address || !Number.isFinite(yearBuilt)) continue;

    const age = currentYear - yearBuilt;
    if (age < 10) continue;

    const city = cityCol !== -1 ? row[cityCol]?.trim() : "";
    const fullAddress = city ? `${address}, ${city}` : address;
    const ownerName = ownerCol !== -1 ? row[ownerCol]?.trim() || null : null;

    candidates.push({ address, town: city || null, fullAddress, ownerName, age });
  }

  const { data: existingLeads } = await supabase
    .from("leads")
    .select("contact_info")
    .eq("source", "mls_import");
  // Tracks both rows already in the DB from a prior import and rows we insert
  // during this run -- MLS exports commonly repeat the same property across
  // multiple rows (status changes, price history), so a duplicate can appear
  // within a single upload, not just across separate uploads.
  const seenAddresses = new Set((existingLeads ?? []).map((l) => l.contact_info));

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const candidate of candidates) {
    if (seenAddresses.has(candidate.fullAddress)) {
      skipped++;
      continue;
    }

    let draftMessage: string;
    try {
      const response = await claude.messages.parse({
        model: CLAUDE_MODEL_FAST,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Property: ${candidate.fullAddress}\nApproximate home age: ${candidate.age} years\nOwner name (if known): ${candidate.ownerName ?? "unknown — address as Current Resident"}`,
          },
        ],
        output_config: { format: zodOutputFormat(MailerSchema) },
      });
      draftMessage = response.parsed_output?.draft_message ?? "";
      if (!draftMessage) throw new Error("empty draft");
    } catch (err) {
      errors.push(`${candidate.fullAddress}: ${err instanceof Error ? err.message : "draft failed"}`);
      continue;
    }

    const { error } = await supabase.from("leads").insert({
      source: "mls_import",
      status: "new",
      contact_name: candidate.ownerName,
      contact_info: candidate.fullAddress,
      address: candidate.address,
      town: candidate.town,
      summary: `Home sold recently, approx. ${candidate.age} years old — likely candidate for HVAC checkup/replacement.`,
      channel: "mail",
      draft_message: draftMessage,
      auto_sendable: false,
    });
    if (error) {
      if (error.message.toLowerCase().includes("duplicate key")) {
        skipped++;
      } else {
        errors.push(`${candidate.fullAddress}: ${error.message}`);
      }
      continue;
    }
    seenAddresses.add(candidate.fullAddress);
    inserted++;
  }

  revalidatePath("/leads");

  const params = new URLSearchParams({ imported: String(inserted), skipped: String(skipped) });
  if (errors.length > 0) {
    params.set("errors", String(errors.length));
    params.set("errorDetail", errors.slice(0, 3).join("; "));
  }
  redirect(`/leads/mls-import?${params.toString()}`);
}
