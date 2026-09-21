import { createServerSupabaseClient } from "./supabase";
import { HttpError } from "./http-error";

export async function requireUser(): Promise<{ id: string; email: string }> {
  const client = await createServerSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Sign in required");
  return { id: user.id, email: user.email ?? "" };
}
