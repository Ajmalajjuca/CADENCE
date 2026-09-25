import { z, ZodError } from "zod";
import { requireUser } from "../../../../../server/auth/require-user";
import { errorResponse } from "../../../../../server/auth/http-error";
import { registerWakeRequest } from "../../../../../server/worker/wake-request";
import { scheduleWorkerWake } from "../../../../../server/worker/schedule-wake";

export async function POST(_request: Request, context: RouteContext<"/api/creation-runs/[id]/wake">) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const status = await registerWakeRequest(user.id, z.uuid().parse(id));
    if (status === "scheduled") scheduleWorkerWake();
    return Response.json({ status });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Run not found" }, { status: 404 });
    return errorResponse(error);
  }
}
