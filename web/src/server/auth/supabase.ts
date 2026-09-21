import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readServerConfig } from "../config";

export async function createServerSupabaseClient() {
  const config = readServerConfig("auth");
  const store = await cookies();
  return createServerClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(entries) {
        try {
          for (const { name, value, options } of entries) store.set(name, value, options);
        } catch {
          // A Server Component cannot set cookies; proxy.ts refreshes sessions.
        }
      },
    },
  });
}
