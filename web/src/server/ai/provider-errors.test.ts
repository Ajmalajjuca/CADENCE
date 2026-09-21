import { expect, it } from "vitest";
import { errorResponse, HttpError } from "../auth/http-error";
import { AiServiceError, mapAnthropicError } from "./provider-errors";

it("maps provider failures to fixed messages without provider secrets", () => {
  const mapped = mapAnthropicError({ status: 401, message: "bad key sk-ant-secret" });
  expect(mapped).toBeInstanceOf(AiServiceError);
  expect(mapped).toMatchObject({ code: "AI_SETTINGS_INVALID", message: "Your Anthropic API key was rejected." });
  expect(mapped.message).not.toContain("sk-ant-secret");
});

it.each([
  [403, "AI_MODEL_UNAVAILABLE"],
  [404, "AI_MODEL_UNAVAILABLE"],
  [429, "AI_RATE_LIMITED"],
  [500, "AI_PROVIDER_UNAVAILABLE"],
])("maps HTTP %s to %s", (status, code) => {
  expect(mapAnthropicError({ status })).toMatchObject({ code });
});

it("includes stable codes in HTTP error responses", async () => {
  const response = errorResponse(new HttpError(409, "Configure Claude", "AI_SETTINGS_REQUIRED"));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Configure Claude", code: "AI_SETTINGS_REQUIRED" });
});

it("returns provider errors to the UI with their stable code", async () => {
  const response = errorResponse(mapAnthropicError({ status: 401, message: "sk-ant-secret" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Your Anthropic API key was rejected.", code: "AI_SETTINGS_INVALID" });
});

it("retains the SDK request ID for safe server correlation", () => {
  expect(mapAnthropicError({ status: 500, requestID: "req_123" })).toMatchObject({ providerRequestId: "req_123" });
});
