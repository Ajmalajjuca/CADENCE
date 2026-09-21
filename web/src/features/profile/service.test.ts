import { expect, it } from "vitest";
import { onboardingInput } from "./schema";
import { toVoiceContext } from "./service";

it("keeps exact writing samples and uses opinion mode with no stories", () => {
  const exactText = "Dear manager,\nI learned this the hard way.";
  const context = toVoiceContext({
    profile: { name: "A", work: "Founder", audience: "Peers", goal: "Trust", voice_traits: [] },
    pillars: [{ name: "Building" }], rules: null,
    samples: [{ text: exactText }], stories: [],
  });
  expect(context.samples[0].text).toBe(exactText);
  expect(context.stories).toEqual([]);
  expect(context.voiceMode).toBe("opinion");
});

it("rejects an empty writing sample and preserves multiline text", () => {
  expect(onboardingInput.safeParse({ step: 4, samples: ["   "], voiceTraits: [] }).success).toBe(false);
  const result = onboardingInput.parse({ step: 4, samples: ["Line one\nLine two"], voiceTraits: [] });
  if (result.step !== 4) throw new Error("Expected writing samples step");
  expect(result.samples[0]).toBe("Line one\nLine two");
});
