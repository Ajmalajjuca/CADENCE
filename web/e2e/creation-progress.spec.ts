import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type RunStatus = "queued" | "running" | "waiting_for_user" | "failed";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let createdUserId: string | undefined;

// These clients only exercise Supabase Auth. Supplying an inert transport keeps
// supabase-js from requiring Node's optional WebSocket support for unused Realtime.
const authOnlyRealtime = {
  transport: class AuthOnlyWebSocket {} as unknown as typeof WebSocket,
};

test.beforeEach(async ({ page }) => {
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Creation browser tests require local Supabase environment variables");
  }

  const email = "creation-e2e-" + randomUUID() + "@test.local";
  const password = "Cadence-e2e-" + randomUUID();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: authOnlyRealtime,
  });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create the browser test user");
  createdUserId = created.data.user.id;

  const browserAuth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: authOnlyRealtime,
  });
  const signedIn = await browserAuth.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error("Could not sign in the browser test user");

  const sessionCookies: Array<{ name: string; value: string }> = [];
  const serverAuth = createServerClient(supabaseUrl, anonKey, {
    realtime: authOnlyRealtime,
    cookies: {
      getAll: () => [],
      setAll: (entries) => { sessionCookies.push(...entries.map(({ name, value }) => ({ name, value }))); },
    },
  });
  const session = await serverAuth.auth.setSession({
    access_token: signedIn.data.session.access_token,
    refresh_token: signedIn.data.session.refresh_token,
  });
  if (session.error) throw session.error;

  await page.context().addCookies(sessionCookies.map(({ name, value }) => ({
    name,
    value,
    url: "http://127.0.0.1:3000",
  })));
});

test.afterEach(async () => {
  if (!supabaseUrl || !serviceRoleKey || !createdUserId) return;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: authOnlyRealtime,
  });
  await admin.auth.admin.deleteUser(createdUserId);
  createdUserId = undefined;
});

function run(status: RunStatus, ageMs: number, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "run-e2e",
    owner_id: "owner-e2e",
    kind: "post",
    mode: "guided",
    entry: "find",
    topic: "",
    direction: "",
    idea_id: null,
    draft_id: null,
    selected_idea: null,
    selected_hook: null,
    stage: "idea",
    status,
    stages: {},
    prompt_version: "cadence-v1",
    model: "",
    usage: {},
    research_model: "claude-sonnet-5",
    writing_model: "claude-sonnet-5",
    ai_settings_revision: 1,
    error_code: null,
    error_message: null,
    attempts: 0,
    lease_owner: null,
    lease_until: null,
    created_at: new Date(now - ageMs).toISOString(),
    updated_at: new Date(now - ageMs).toISOString(),
    ...overrides,
  };
}

test("walks through cold-worker recovery, progress, choice, and a safe failure", async ({ page }) => {
  const responses = [
    // Keep the first transient state stable even when CI startup is slow.
    run("queued", -60_000),
    run("queued", 30_000),
    run("queued", 95_000),
    run("running", 0),
    run("waiting_for_user", 0, {
      stages: {
        idea: {
          ideas: [{
            id: "idea-e2e",
            title: "The maintenance work behind small AI features",
            angle: "Useful products are built after the demo.",
            whyNow: "Teams are learning what lasts.",
            pillar: "Building",
            sourceUrls: [],
          }],
        },
      },
    }),
    run("failed", 0, { error_code: "AI_OUTPUT_INVALID", error_message: "raw provider output must stay hidden" }),
  ];
  let phase = 0;
  let wakeRequests = 0;

  await page.route("**/api/settings/ai", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "valid" }) });
  });
  await page.route("**/api/creation-runs", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(responses[0]) });
  });
  await page.route("**/api/creation-runs/run-e2e/wake", async (route) => {
    wakeRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "scheduled" }) });
  });
  await page.route("**/api/creation-runs/run-e2e/choice", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(run("queued", 0)) });
  });
  await page.route("**/api/creation-runs/run-e2e", async (route) => {
    const body = responses[phase];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/create");
  await page.getByRole("radio", { name: /Guided/ }).check();
  await page.getByRole("button", { name: "Find ideas" }).click();
  await expect(page).toHaveURL(/\/create\/run-e2e/);

  await expect(page.getByRole("heading", { name: "Preparing your run" })).toBeVisible();
  await expect(page.getByText("Find an idea")).toHaveAttribute("data-state", "active");
  phase = 1;
  await expect(page.getByRole("heading", { name: "Worker is waking up" })).toBeVisible({ timeout: 6_000 });
  phase = 2;
  await expect(page.getByRole("heading", { name: "This is taking longer than expected" })).toBeVisible({ timeout: 6_000 });

  phase = 3;
  await page.getByRole("button", { name: "Wake worker and check again" }).click();
  await expect(page.getByText("Wake request sent. Checking again…")).toBeVisible();
  expect(wakeRequests).toBe(1);
  await expect(page.getByRole("heading", { name: "Finding an idea" })).toBeVisible();

  phase = 4;
  await expect(page.getByRole("heading", { name: "Choose an idea" })).toBeVisible({ timeout: 6_000 });
  phase = 5;
  await page.getByRole("button", { name: "Choose this idea" }).click();

  await expect(page.getByRole("heading", { name: "Claude returned an unusable result" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry this stage" })).toBeVisible();
  await expect(page.getByText("raw provider output must stay hidden")).toHaveCount(0);
});
