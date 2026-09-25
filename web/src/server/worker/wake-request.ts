import { HttpError } from "../auth/http-error";
import { withTransaction } from "../db/client";

export type WakeRequestStatus = "scheduled" | "cooldown";

export async function registerWakeRequest(ownerId: string, runId: string): Promise<WakeRequestStatus> {
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`worker-wake:${runId}`]);

    const run = await client.query<{ status: string }>(
      "select status from public.creation_runs where id=$1 and owner_id=$2",
      [runId, ownerId],
    );
    if (!run.rows[0]) throw new HttpError(404, "Creation run not found");
    if (run.rows[0].status !== "queued") {
      throw new HttpError(409, "Only a queued run can wake the worker");
    }

    const recent = await client.query(
      "select 1 from public.activity_events where owner_id=$1 and related_id=$2 and event_type='worker.wake_requested' and created_at > now()-interval '30 seconds' limit 1",
      [ownerId, runId],
    );
    if (recent.rowCount) return "cooldown";

    await client.query(
      "insert into public.activity_events(owner_id,event_type,related_id) values($1,'worker.wake_requested',$2)",
      [ownerId, runId],
    );
    return "scheduled";
  });
}
