import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { chooseRunHook, chooseRunIdea } from "../../../../../server/jobs/creation-service";
import { scheduleWorkerWake } from "../../../../../server/worker/schedule-wake";

const choiceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idea"), choiceId: z.string().min(1) }),
  z.object({ kind: z.literal("hook"), choiceId: z.string().min(1) }),
]);

export async function POST(request: Request, context: RouteContext<"/api/creation-runs/[id]/choice">) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const runId = z.uuid().parse(id);
    const input = choiceInput.parse(await request.json());
    const run = input.kind === "idea"
      ? await chooseRunIdea(user.id, runId, input.choiceId)
      : await chooseRunHook(user.id, runId, input.choiceId);
    scheduleWorkerWake();
    return Response.json(run);
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid choice" }, { status: 400 });
    return errorResponse(error);
  }
}
