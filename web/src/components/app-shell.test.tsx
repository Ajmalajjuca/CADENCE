// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mockPathname = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: mockPathname }));

import { AppShell } from "./app-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("marks only the current destination", () => {
  mockPathname.mockReturnValue("/library");
  render(<AppShell><p>Page</p></AppShell>);

  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Create" })).not.toHaveAttribute("aria-current");
});

it("keeps a nested route within its current navigation section", () => {
  mockPathname.mockReturnValue("/create/run-1");
  render(<AppShell><p>Page</p></AppShell>);

  expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Your words, your approval");
});
