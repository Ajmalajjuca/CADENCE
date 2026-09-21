// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SignInPage from "./page";

afterEach(() => vi.unstubAllGlobals());

it("shows the actionable API error when a magic link cannot be sent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({
      error: "Supabase's email limit has been reached. Wait and try again, or configure custom SMTP.",
    }),
  }));
  render(<SignInPage />);

  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invited@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));

  expect((await screen.findByRole("status")).textContent).toContain("Supabase's email limit has been reached");
});
