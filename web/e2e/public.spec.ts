import { expect, test } from "@playwright/test";

test("public home explains the workflow and directs invitees to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good ideas deserve your voice." })).toBeVisible();
  await expect(page.getByText("No prompts to learn.")).toBeVisible();
  await page.getByRole("link", { name: "Create a post" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in to Cadence" })).toBeVisible();
});
