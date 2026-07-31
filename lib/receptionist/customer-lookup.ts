import { supabase } from "@/lib/supabase";

export type MatchedCustomer = { id: string; name: string; email: string | null } | null;

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

export async function findCustomerByPhone(phone: string): Promise<MatchedCustomer> {
  const target = normalizePhone(phone);
  if (!target) return null;

  const { data: customers } = await supabase.from("customers").select("id, name, email, phone");
  const match = (customers ?? []).find((c) => c.phone && normalizePhone(c.phone) === target);
  return match ? { id: match.id, name: match.name, email: match.email } : null;
}
