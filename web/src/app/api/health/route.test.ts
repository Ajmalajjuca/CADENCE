import { expect, it } from "vitest";
import { GET } from "./route";

it("answers health without external credentials", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
