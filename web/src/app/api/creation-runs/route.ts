import { ZodError } from "zod";
import { requireUser } from "../../../server/auth/require-user";
import { errorResponse } from "../../../server/auth/http-error";
import { getPool } from "../../../server/db/client";
import { startCreationRun } from "../../../server/jobs/creation-service";
import { scheduleWorkerWake } from "../../../server/worker/schedule-wake";
import type { CreationRun } from "../../../server/db/types";

export async function GET() {
  try {
    const user = await requireUser();
    const result = await getPool().query<CreationRun>("select * from public.creation_runs where owner_id=$1 order by created_at desc limit 20", [user.id]);
    return Response.json(result.rows);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const run = await startCreationRun(user.id, await request.json());
    scheduleWorkerWake();
    return Response.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Choose a path and enter a topic if needed" }, { status: 400 });
    return errorResponse(error);
  }
}
