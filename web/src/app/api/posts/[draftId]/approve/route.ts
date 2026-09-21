import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { approveVersion } from "../../../../../features/drafts/service";

const inputSchema = z.object({ versionId: z.uuid() });

export async function POST(request: Request, context: RouteContext<"/api/posts/[draftId]/approve">) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    const input = inputSchema.parse(await request.json());
    return Response.json(await approveVersion(user.id,input.versionId,z.uuid().parse(draftId)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Select a draft version" }, { status: 400 });
    return errorResponse(error);
  }
}
