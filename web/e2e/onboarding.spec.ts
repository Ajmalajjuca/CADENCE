import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let createdUserId: string | undefined;
const authOnlyRealtime = { transport: class AuthOnlyWebSocket {} as unknown as typeof WebSocket };

test.beforeEach(async ({ page }) => {
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Onboarding browser tests require local Supabase environment variables");
  const email = `onboarding-e2e-${randomUUID()}@test.local`;
  const password = `Cadence-e2e-${randomUUID()}`;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: authOnlyRealtime });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create the browser test user");
  createdUserId = created.data.user.id;

  const browserAuth = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: authOnlyRealtime });
  const signedIn = await browserAuth.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error("Could not sign in the browser test user");
  const sessionCookies: Array<{ name: string; value: string }> = [];
  const serverAuth = createServerClient(supabaseUrl, anonKey, {
    realtime: authOnlyRealtime,
    cookies: { getAll: () => [], setAll: (entries) => { sessionCookies.push(...entries.map(({ name, value }) => ({ name, value }))); } },
  });
  const session = await serverAuth.auth.setSession({ access_token: signedIn.data.session.access_token, refresh_token: signedIn.data.session.refresh_token });
  if (session.error) throw session.error;
  await page.context().addCookies(sessionCookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3000" })));
});

test.afterEach(async () => {
  if (!supabaseUrl || !serviceRoleKey || !createdUserId) return;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: authOnlyRealtime });
  await admin.auth.admin.deleteUser(createdUserId);
  createdUserId = undefined;
});

const emptyProfile = { profile: null, pillars: [], rules: null, samples: [], stories: [] };

function returningProfile(pillars = ["AI", "Building", "Leadership"]) {
  return {
    profile: { name: "Ajmal", work: "Founder", location: "India", audience: "Founders", goal: "Build trust", voice_traits: ["Direct"], onboarding_step: 6, onboarding_complete: true },
    pillars: pillars.map((name) => ({ name })),
    rules: null,
    samples: [{ text: "A short writing sample." }],
    stories: [],
  };
}

test("completes a resumable first-time voice interview", async ({ page }) => {
  const saved: Array<Record<string, unknown>> = [];
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyProfile) });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saved.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyProfile) });
  });
  await page.route("**/api/settings/ai", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "not_configured" }) }));

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await page.getByLabel("Name").fill("Ajmal");
  await page.getByLabel("Work").fill("Founder");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Step 2 of 6")).toBeVisible();
  await page.getByRole("button", { name: "Product leaders" }).click();
  await page.getByRole("button", { name: "Share what I learn" }).click();
  await page.getByLabel("Goal").fill("Help product leaders ship responsible AI");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Add a content topic").fill("AI product craft");
  await page.getByRole("button", { name: "Add topic" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Writing sample 1").fill("A real sample.\n\nWith deliberate spacing.");
  await page.getByRole("button", { name: "Direct" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "How should Cadence shape each post?" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Cadence may use only the details you add here. It will never invent personal experiences.")).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page).toHaveURL(/\/create$/);
  expect(saved.map((payload) => payload.step)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(saved[5]).toEqual({ step: 6, stories: [] });
  expect(saved[3]).toMatchObject({ step: 4, samples: ["A real sample.\n\nWith deliberate spacing."], voiceTraits: ["Direct"] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("edits one returning-user profile section without leaving the overview", async ({ page }) => {
  let pillars = ["AI", "Building", "Leadership"];
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { step: number; pillars?: string[] };
      if (body.step === 3 && body.pillars) pillars = body.pillars;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(returningProfile(pillars)) });
  });

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Your voice profile" })).toBeVisible();
  await expect(page.getByText("3 content topics")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Edit Content topics" }).click();
  await expect(page.getByRole("heading", { name: "What topics do you want to be known for?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Building" }).click();
  await page.getByRole("button", { name: "Remove Leadership" }).click();
  await page.getByRole("button", { name: "Save section" }).click();

  await expect(page.getByRole("heading", { name: "Your voice profile" })).toBeVisible();
  await expect(page.getByText("1 content topic")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
