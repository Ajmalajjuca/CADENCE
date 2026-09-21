import { z, ZodError } from "zod";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { setIdeaStatus } from "../../../../features/ideas/service";
import { ideaStatus } from "../../../../features/ideas/schema";

export async function PATCH(request: Request, context: RouteContext<"/api/ideas/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = z.object({ status: ideaStatus }).parse(await request.json());
    return Response.json(await setIdeaStatus(user.id, id, input.status));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid status" }, { status: 400 });
    return errorResponse(error);
  }
}
