"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function asString(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

export async function signIn(formData: FormData) {
  const parsed = CredentialsSchema.safeParse({
    email: asString(formData.get("email")),
    password: asString(formData.get("password")),
  });
  if (!parsed.success) {
    redirect("/login?error=invalid_credentials");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}
