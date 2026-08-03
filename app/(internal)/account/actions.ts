"use server";

import { createPortalServerClient } from "@/lib/supabase-portal/server";

export async function updatePassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createPortalServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You need to be signed in to change your password." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { success: true };
}
