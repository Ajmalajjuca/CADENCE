import { beforeEach, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const createServerSupabaseClient = vi.fn(async () => ({ auth: { signInWithOtp } }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => { throw new Error("The implicit-flow client must not be used for server-side sign-in"); },
}));

vi.mock("@/server/auth/supabase", () => ({
  createServerSupabaseClient,
}));

vi.mock("@/server/config", () => ({
  readServerConfig: (scope: string) => scope === "auth"
    ? { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }
    : { APP_URL: "http://localhost:3000" },
}));

beforeEach(() => {
  signInWithOtp.mockReset();
  createServerSupabaseClient.mockClear();
});

it("uses the server PKCE client when requesting a magic link", async () => {
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  const { POST } = await import("./route");

  const response = await POST(new Request("http://localhost/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ email: "invited@example.com" }),
  }));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "sent" });
});

it("reports the Supabase email limit instead of blaming the invitation", async () => {
  signInWithOtp.mockResolvedValue({
    data: {},
    error: {
      name: "AuthApiError",
      status: 429,
      code: "over_email_send_rate_limit",
      message: "email rate limit exceeded",
    },
  });
  const { POST } = await import("./route");

  const response = await POST(new Request("http://localhost/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ email: "invited@example.com" }),
  }));

  expect(response.status).toBe(429);
  await expect(response.json()).resolves.toEqual({
    error: "Supabase's email limit has been reached. Wait and try again, or configure custom SMTP.",
  });
});
