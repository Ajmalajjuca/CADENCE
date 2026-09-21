import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/server/auth/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/sign-in?error=missing-code", url));
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url));
  return NextResponse.redirect(new URL("/onboarding", url));
}
