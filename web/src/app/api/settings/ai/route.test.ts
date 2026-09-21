import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../../server/auth/http-error";

const service = vi.hoisted(() => ({
  getSafeAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  removeAiSettings: vi.fn(),
  consumeValidationAttempt: vi.fn(),
}));

vi.mock("../../../../server/auth/require-user", () => ({ requireUser: async () => ({ id: "owner-a" }) }));
vi.mock("../../../../features/settings/ai-settings", () => service);

import { DELETE, GET, PUT } from "./route";
import { GET as GET_MODELS } from "./models/route";

afterEach(() => vi.clearAllMocks());

it("returns only safe settings metadata", async () => {
  service.getSafeAiSettings.mockResolvedValue({ status: "valid", keySuffix: "1234", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", validatedAt: "2026-09-21T00:00:00.000Z" });
  const response = await GET();
  const text = await response.text();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(text).toContain('"keySuffix":"1234"');
  expect(text).not.toMatch(/apiKey|api_key_encrypted|v1:/);
});

it("rate limits before validating and saving settings", async () => {
  service.consumeValidationAttempt.mockResolvedValue(undefined);
  service.saveAiSettings.mockResolvedValue({ status: "valid", keySuffix: "1234" });
  const response = await PUT(new Request("http://localhost/api/settings/ai", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "sk-ant-test", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" }) }));
  expect(response.status).toBe(200);
  expect(service.consumeValidationAttempt).toHaveBeenCalledWith("owner-a");
  expect(service.saveAiSettings).toHaveBeenCalledWith("owner-a", expect.objectContaining({ apiKey: "sk-ant-test" }));
});

it("returns stable service error codes", async () => {
  service.consumeValidationAttempt.mockResolvedValue(undefined);
  service.saveAiSettings.mockRejectedValue(new HttpError(400, "Choose a supported Claude model", "AI_MODEL_NOT_ALLOWED"));
  const response = await PUT(new Request("http://localhost/api/settings/ai", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "sk-ant-test", researchModel: "bad", writingModel: "claude-opus-5" }) }));
  expect(await response.json()).toEqual({ error: "Choose a supported Claude model", code: "AI_MODEL_NOT_ALLOWED" });
});

it("surfaces active-run deletion conflicts", async () => {
  service.removeAiSettings.mockRejectedValue(new HttpError(409, "Finish active creation runs before removing Claude settings", "AI_SETTINGS_IN_USE"));
  const response = await DELETE();
  expect(response.status).toBe(409);
});

it("returns the safe curated model catalog", async () => {
  const response = await GET_MODELS();
  const body = await response.json();
  expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  expect(body.models.map((model: { id: string }) => model.id)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  expect(JSON.stringify(body)).not.toMatch(/apiKey|secret/);
});
