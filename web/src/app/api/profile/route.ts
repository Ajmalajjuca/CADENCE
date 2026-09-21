import { ZodError } from "zod";
import { requireUser } from "../../../server/auth/require-user";
import { errorResponse } from "../../../server/auth/http-error";
import { getProfileState, saveOnboardingStep } from "../../../features/profile/service";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await getProfileState(user.id));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const state = await saveOnboardingStep(user.id, await request.json());
    return Response.json(state);
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Please check the required fields", details: error.issues }, { status: 400 });
    return errorResponse(error);
  }
}
