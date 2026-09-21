import { expect, it, vi } from "vitest";
import { validateAnthropicCredentials } from "./validate-credentials";

it("validates each distinct selected model without creating a message", async () => {
  const retrieve = vi.fn().mockResolvedValue({ capabilities: { structured_outputs: { supported: true } } });
  await validateAnthropicCredentials("sk-ant-test", "claude-sonnet-5", "claude-opus-5", { retrieve });
  expect(retrieve).toHaveBeenNthCalledWith(1, "claude-sonnet-5");
  expect(retrieve).toHaveBeenNthCalledWith(2, "claude-opus-5");
});

it("checks a shared research and writing model only once", async () => {
  const retrieve = vi.fn().mockResolvedValue({ capabilities: { structured_outputs: { supported: true } } });
  await validateAnthropicCredentials("sk-ant-test", "claude-sonnet-5", "claude-sonnet-5", { retrieve });
  expect(retrieve).toHaveBeenCalledTimes(1);
});

it("rejects an account response that explicitly lacks structured outputs", async () => {
  const retrieve = vi.fn().mockResolvedValue({ capabilities: { structured_outputs: { supported: false } } });
  await expect(validateAnthropicCredentials("sk-ant-test", "claude-sonnet-5", "claude-opus-5", { retrieve })).rejects.toMatchObject({ code: "AI_MODEL_UNAVAILABLE" });
});

it("sanitizes model API authentication failures", async () => {
  const retrieve = vi.fn().mockRejectedValue({ status: 401, message: "rejected sk-ant-test" });
  await expect(validateAnthropicCredentials("sk-ant-test", "claude-sonnet-5", "claude-opus-5", { retrieve })).rejects.toMatchObject({ code: "AI_SETTINGS_INVALID" });
});
