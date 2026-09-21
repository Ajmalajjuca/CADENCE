import { ZodError, z } from "zod";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { consumeValidationAttempt, getSafeAiSettings, removeAiSettings, saveAiSettings } from "../../../../features/settings/ai-settings";

const updateAiSettings = z.object({
  apiKey: z.string().trim().min(8).max(500).optional(),
  researchModel: z.string().min(1).max(100),
  writingModel: z.string().min(1).max(100),
});

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await getSafeAiSettings(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const input = updateAiSettings.parse(await request.json());
    await consumeValidationAttempt(user.id);
    return Response.json(await saveAiSettings(user.id, input));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Check the API key and model selections", code: "AI_SETTINGS_INVALID_INPUT" }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await removeAiSettings(user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
