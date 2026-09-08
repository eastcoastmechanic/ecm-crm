"use server";

import { revalidatePath } from "next/cache";
import { syncSquarePayments, type SquareSyncResult } from "@/lib/square-sync";

export async function runSquarePaymentSync(): Promise<SquareSyncResult> {
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
