// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Button, Callout, ChoiceChip, Field, StatusBadge } from "./ui";

afterEach(cleanup);

it("keeps primary buttons native, disableable, and open to custom classes", () => {
  render(<Button disabled className="save-control">Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("type", "button");
  expect(button).toHaveClass("button-primary", "save-control");
});

it("connects a Field label to its native control", () => {
  render(<Field label="Email address" htmlFor="email"><input id="email" /></Field>);
  expect(screen.getByLabelText("Email address")).toHaveAttribute("id", "email");
});

it("keeps choice, badge, and callout semantics visible beyond color", () => {
  render(<>
    <ChoiceChip selected><input type="checkbox" />Direct</ChoiceChip>
    <StatusBadge tone="success" className="saved-state">Saved</StatusBadge>
    <Callout tone="danger">Could not save</Callout>
    <Callout role="status">Saving</Callout>
  </>);

  expect(screen.getByText("Direct").closest("label")).toHaveAttribute("data-selected", "true");
  expect(screen.getByText("Saved")).toHaveAttribute("data-tone", "success");
  expect(screen.getByText("Saved")).toHaveClass("saved-state");
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.getByRole("status")).toHaveTextContent("Saving");
});
