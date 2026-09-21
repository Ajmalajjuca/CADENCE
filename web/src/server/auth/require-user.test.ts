import { beforeEach, expect, it, vi } from "vitest";
import { requireUser } from "./require-user";
import { createServerSupabaseClient } from "./supabase";

vi.mock("./supabase", () => ({ createServerSupabaseClient: vi.fn() }));
const mockedClient = vi.mocked(createServerSupabaseClient);

beforeEach(() => mockedClient.mockReset());

it("returns 401 when there is no verified session", async () => {
  mockedClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as never);
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
});

it("returns only the verified user identity", async () => {
  mockedClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-a", email: "a@test.com" } }, error: null }) } } as never);
  await expect(requireUser()).resolves.toEqual({ id: "user-a", email: "a@test.com" });
});
