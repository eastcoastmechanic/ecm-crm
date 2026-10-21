"use server";

import { revalidatePath } from "next/cache";
import { syncSquarePayments, type SquareSyncResult } from "@/lib/square-sync";
import { requireOffice } from "@/lib/require-role";

export async function runSquarePaymentSync(): Promise<SquareSyncResult> {
  await requireOffice();
  const result = await syncSquarePayments();
  if (!result.error) {
    revalidatePath("/payments");
    revalidatePath("/documents");
    revalidatePath("/dashboard");
    revalidatePath("/customers");
    revalidatePath("/analytics");
  }
  return result;
}
