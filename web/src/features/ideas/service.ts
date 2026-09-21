import { getPool, withTransaction } from "../../server/db/client";
import { HttpError } from "../../server/auth/http-error";
import { ideaInput, type IdeaStatus } from "./schema";

export type Idea = {
  id: string; owner_id: string; title: string; angle: string; why_now: string;
  pillar_id: string | null; status: IdeaStatus; created_at: Date; updated_at: Date;
};

export async function createIdea(ownerId: string, raw: unknown): Promise<Idea> {
  const input = ideaInput.parse(raw);
  return withTransaction(async client => {
    if (input.pillarId) {
      const owned = await client.query("select 1 from public.pillars where id=$1 and owner_id=$2", [input.pillarId,ownerId]);
      if (!owned.rowCount) throw new HttpError(404, "Pillar not found");
    }
    const result = await client.query<Idea>(
      `insert into public.ideas(owner_id,title,angle,pillar_id,why_now,status)
       values($1,$2,$3,$4,$5,'saved') returning *`,
      [ownerId,input.title,input.angle,input.pillarId ?? null,input.whyNow]
    );
    await client.query("insert into public.activity_events(owner_id,event_type,related_id) values($1,'idea.created',$2)", [ownerId,result.rows[0].id]);
    return result.rows[0];
  });
}

export async function listIdeas(ownerId: string, filter: { query?: string; status?: IdeaStatus; pillarId?: string } = {}): Promise<Idea[]> {
  const result = await getPool().query<Idea>(
    `select * from public.ideas where owner_id=$1
       and ($2::text is null or status=$2)
       and ($3::uuid is null or pillar_id=$3)
       and ($4::text is null or title ilike '%' || $4 || '%' or angle ilike '%' || $4 || '%')
     order by updated_at desc,id desc limit 200`,
    [ownerId,filter.status ?? null,filter.pillarId ?? null,filter.query?.trim() || null]
  );
  return result.rows;
}

export async function setIdeaStatus(ownerId: string, ideaId: string, status: IdeaStatus): Promise<Idea> {
  return withTransaction(async client => {
    const result = await client.query<Idea>("update public.ideas set status=$3,updated_at=now() where owner_id=$1 and id=$2 returning *", [ownerId,ideaId,status]);
    const idea = result.rows[0];
    if (!idea) throw new HttpError(404, "Idea not found");
    await client.query("insert into public.activity_events(owner_id,event_type,related_id,detail) values($1,'idea.status_changed',$2,$3)", [ownerId,ideaId,JSON.stringify({ status })]);
    return idea;
  });
}
