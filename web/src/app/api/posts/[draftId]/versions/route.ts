import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { createVersion } from "../../../../../features/drafts/service";

const inputSchema = z.object({ text: z.string(), sourceRefs: z.array(z.url()).default([]) });

export async function POST(request: Request, context: RouteContext<"/api/posts/[draftId]/versions">) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    const input = inputSchema.parse(await request.json());
    return Response.json(await createVersion(user.id,z.uuid().parse(draftId),input.text,input.sourceRefs), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Post text is required" }, { status: 400 });
    return errorResponse(error);
  }
}
