import { z, ZodError } from "zod";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { getDraftForReview } from "../../../../features/drafts/service";

export async function GET(_request: Request, context: RouteContext<"/api/posts/[draftId]">) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    return Response.json(await getDraftForReview(user.id,z.uuid().parse(draftId)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Draft not found" }, { status: 404 });
    return errorResponse(error);
  }
}
