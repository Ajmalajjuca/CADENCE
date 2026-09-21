import { expect, it, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "../../../server/auth/require-user";
import { HttpError } from "../../../server/auth/http-error";

vi.mock("../../../server/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("../../../features/profile/service", () => ({ getProfileState: vi.fn() }));

it("requires authentication before reading profile data", async () => {
  vi.mocked(requireUser).mockRejectedValue(new HttpError(401, "Sign in required"));
  const response = await GET();
  expect(response.status).toBe(401);
});
