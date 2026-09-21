import { expect, it } from "vitest";
import { creationInput } from "./creation-service";

it("requires a topic for the topic path but not surprise mode", () => {
  expect(creationInput.safeParse({ mode: "quick", entry: "topic", topic: "" }).success).toBe(false);
  expect(creationInput.safeParse({ mode: "quick", entry: "surprise" }).success).toBe(true);
});
