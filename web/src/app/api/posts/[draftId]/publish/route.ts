import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { publishApprovedVersion } from "../../../../../server/linkedin/publisher";

export async function POST(_request: Request, context: RouteContext<"/api/posts/[draftId]/publish">) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    return Response.json(await publishApprovedVersion(user.id,z.uuid().parse(draftId)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Draft not found" }, { status: 404 });
    return errorResponse(error);
  }
}
