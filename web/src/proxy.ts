import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.redirect(new URL("/sign-in?error=config", request.url));

  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(entries) {
        for (const { name, value } of entries) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of entries) response.cookies.set(name, value, options);
      },
    },
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = { matcher: ["/create/:path*", "/library/:path*", "/ideas/:path*", "/onboarding/:path*", "/profile/:path*", "/posts/:path*", "/connections/:path*", "/settings/:path*"] };
