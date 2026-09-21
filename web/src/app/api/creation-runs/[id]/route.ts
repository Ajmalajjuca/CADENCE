import { z, ZodError } from "zod";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { getRun, retryRun } from "../../../../server/jobs/creation-service";

export async function GET(_request: Request, context: RouteContext<"/api/creation-runs/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return Response.json(await getRun(user.id, z.uuid().parse(id)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Run not found" }, { status: 404 });
    return errorResponse(error);
  }
}

export async function PATCH(_request: Request, context: RouteContext<"/api/creation-runs/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return Response.json(await retryRun(user.id, z.uuid().parse(id)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Run not found" }, { status: 404 });
    return errorResponse(error);
  }
}
