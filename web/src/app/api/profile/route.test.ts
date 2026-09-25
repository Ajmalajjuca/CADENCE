import { beforeEach, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";
import { requireUser } from "../../../server/auth/require-user";
import { HttpError } from "../../../server/auth/http-error";
import { saveOnboardingStep } from "../../../features/profile/service";

vi.mock("../../../server/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("../../../features/profile/service", () => ({ getProfileState: vi.fn(), saveOnboardingStep: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it("requires authentication before reading profile data", async () => {
  vi.mocked(requireUser).mockRejectedValue(new HttpError(401, "Sign in required"));
  const response = await GET();
  expect(response.status).toBe(401);
});

it("returns stable validation details for an invalid profile step", async () => {
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof requireUser>>);
  vi.mocked(saveOnboardingStep).mockRejectedValue(new (await import("zod")).ZodError([
    { code: "custom", path: ["name"], message: "Required" },
  ]));

  const response = await PATCH(new Request("http://localhost/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ step: 1 }),
  }));
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: "Please check the required fields",
    details: [{ path: ["name"], message: "Required" }],
  });
});

it("returns the updated profile state after a valid save", async () => {
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof requireUser>>);
  vi.mocked(saveOnboardingStep).mockResolvedValue({ profile: { name: "Ajmal" } } as Awaited<ReturnType<typeof saveOnboardingStep>>);

  const response = await PATCH(new Request("http://localhost/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ step: 1, name: "Ajmal", work: "Founder", location: "" }),
  }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ profile: { name: "Ajmal" } });
});

it("does not expose service error details", async () => {
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof requireUser>>);
  vi.mocked(saveOnboardingStep).mockRejectedValue(new Error("database password leaked"));

  const response = await PATCH(new Request("http://localhost/api/profile", { method: "PATCH", body: "{}" }));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("database password leaked");
});
