import { z } from "zod";
import { readServerConfig } from "@/server/config";
import { createServerSupabaseClient } from "@/server/auth/supabase";

const inputSchema = z.object({ email: z.email() });

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  const app = readServerConfig("app");
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: new URL("/auth/callback", app.APP_URL).toString() },
  });
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return Response.json(
        { error: "Supabase's email limit has been reached. Wait and try again, or configure custom SMTP." },
        { status: 429 },
      );
    }
    return Response.json({ error: "Could not send sign-in link" }, { status: 400 });
  }
  return Response.json({ status: "sent" });
}
