import { describe, expect, it } from "vitest";
import {
  clearOptionalSection,
  emptyProfileForm,
  firstIncompleteStep,
  normalizeProfileState,
  payloadForStep,
  sectionSummaries,
} from "./profile-form-model";

describe("profile form model", () => {
  it("normalizes a new user without assuming nested arrays", () => {
    expect(normalizeProfileState({ profile: null })).toEqual(expect.objectContaining({
      name: "",
      work: "",
      audience: "",
      pillars: [],
      samples: [""],
      stories: [{ title: "", details: "", usageNote: "" }],
    }));
  });

  it("normalizes malformed collections and missing rules safely", () => {
    const form = normalizeProfileState({
      profile: { voice_traits: null },
      pillars: null,
      samples: "not-an-array",
      stories: {},
    });

    expect(form.voiceTraits).toEqual([]);
    expect(form.pillars).toEqual([]);
    expect(form.samples).toEqual([""]);
    expect(form.stories).toEqual([{ title: "", details: "", usageNote: "" }]);
    expect(form.lengthPreference).toBe("");
  });

  it("preserves exact multiline samples and story details", () => {
    const form = normalizeProfileState({
      samples: [{ text: "Line one\n\nLine two." }],
      stories: [{ title: "Launch", details: "Exact — details", usage_note: "Use for lessons" }],
    });

    expect(payloadForStep(form, 4)).toMatchObject({ samples: ["Line one\n\nLine two."] });
    expect(payloadForStep(form, 6)).toMatchObject({
      stories: [{ title: "Launch", details: "Exact — details", usageNote: "Use for lessons" }],
    });
  });

  it("rejects a partially entered story instead of silently discarding it", () => {
    expect(() => payloadForStep({
      ...emptyProfileForm,
      stories: [{ title: "Launch", details: "", usageNote: "Use for lessons" }],
    }, 6)).toThrow(/details/i);
  });

  it("creates deliberate empty payloads for optional sections", () => {
    expect(payloadForStep(emptyProfileForm, 4)).toEqual({ step: 4, samples: [], voiceTraits: [] });
    expect(payloadForStep(emptyProfileForm, 5)).toEqual({
      step: 5,
      rules: {
        lengthPreference: "",
        casing: "",
        hashtags: "",
        emoji: "",
        cta: "",
        bannedTerms: [],
        notes: "",
      },
    });
    expect(payloadForStep(emptyProfileForm, 6)).toEqual({ step: 6, stories: [] });
  });

  it("trims list labels, preserves visible order, and rejects more than four pillars", () => {
    const form = { ...emptyProfileForm, pillars: ["  AI ", "Building", "", "Teams"] };
    expect(payloadForStep(form, 3)).toEqual({ step: 3, pillars: ["AI", "Building", "Teams"] });
    expect(() => payloadForStep({ ...form, pillars: ["1", "2", "3", "4", "5"] }, 3)).toThrow(/four/i);
  });

  it("clears only optional sections and refuses required ones", () => {
    const form = {
      ...emptyProfileForm,
      name: "Ajmal",
      samples: ["sample"],
      voiceTraits: ["direct"],
      lengthPreference: "short",
      stories: [{ title: "Launch", details: "Details", usageNote: "Lessons" }],
    };

    expect(clearOptionalSection(form, 4)).toEqual(expect.objectContaining({ name: "Ajmal", samples: [""], voiceTraits: [] }));
    expect(clearOptionalSection(form, 5)).toEqual(expect.objectContaining({ name: "Ajmal", lengthPreference: "" }));
    expect(clearOptionalSection(form, 6)).toEqual(expect.objectContaining({ name: "Ajmal", stories: [{ title: "", details: "", usageNote: "" }] }));
    expect(() => clearOptionalSection(form, 3)).toThrow(/required/i);
  });

  it("finds the first incomplete essential section and respects saved optional steps", () => {
    expect(firstIncompleteStep({ profile: null })).toBe(1);
    expect(firstIncompleteStep({ profile: { name: "A", work: "Builder", audience: "", goal: "" } })).toBe(2);
    expect(firstIncompleteStep({
      profile: { name: "A", work: "Builder", audience: "Founders", goal: "Trust", onboarding_step: 3 },
      pillars: [{ name: "AI" }],
    })).toBe(4);
    expect(firstIncompleteStep({
      profile: { name: "A", work: "Builder", audience: "Founders", goal: "Trust", onboarding_step: 5 },
      pillars: [{ name: "AI" }],
    })).toBe(6);
    expect(firstIncompleteStep({
      profile: { name: "", work: "Builder", audience: "Founders", goal: "Trust", onboarding_step: 6 },
      pillars: [{ name: "AI" }],
    })).toBe(1);
    expect(firstIncompleteStep({
      profile: { name: "A", work: "Builder", audience: "", goal: "Trust", onboarding_step: 6 },
      pillars: [{ name: "AI" }],
    })).toBe(2);
    expect(firstIncompleteStep({
      profile: { name: "A", work: "Builder", audience: "Founders", goal: "Trust", onboarding_step: 6 },
      pillars: [],
    })).toBe(3);
  });

  it("builds safe overview summaries", () => {
    const summaries = sectionSummaries({
      ...emptyProfileForm,
      name: "Ajmal",
      work: "Founder",
      pillars: ["AI", "Building", "Leadership"],
    });

    expect(summaries[0]).toMatchObject({ label: "About you", complete: true });
    expect(summaries[2].summary).toBe("3 content topics");
    expect(summaries[5]).toMatchObject({ summary: "Not added yet", complete: false });
  });
});
