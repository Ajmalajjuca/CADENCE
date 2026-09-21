import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { listModels } from "../../../../../server/ai/model-catalog";

export async function GET() {
  try {
    await requireUser();
    return Response.json({ models: listModels() }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) { return errorResponse(error); }
}
