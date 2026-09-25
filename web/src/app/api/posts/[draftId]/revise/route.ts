import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { startRevisionRun } from "../../../../../server/jobs/creation-service";
import { scheduleWorkerWake } from "../../../../../server/worker/schedule-wake";

const inputSchema = z.object({ direction: z.string().trim().min(1).max(1000) });
export async function POST(request: Request, context: RouteContext<"/api/posts/[draftId]/revise">) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    const input = inputSchema.parse(await request.json());
    const run = await startRevisionRun(user.id, z.uuid().parse(draftId), input.direction);
    scheduleWorkerWake();
    return Response.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Describe the revision you want" }, { status: 400 });
    return errorResponse(error);
  }
}
