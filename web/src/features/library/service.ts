import { getPool } from "../../server/db/client";

export type LibraryStatus = "saved" | "used" | "discarded" | "draft" | "approved" | "published" | "failed" | "uncertain" | "in_progress";
export type LibraryItem = { id: string; kind: "idea" | "post"; status: LibraryStatus; title: string; pillar: string | null; updated_at: Date; href: string };

export async function listLibrary(ownerId: string, filter: { status?: LibraryStatus; query?: string } = {}): Promise<LibraryItem[]> {
  const result = await getPool().query<LibraryItem>(
    `with items as (
      select i.id, 'idea'::text as kind, i.status, i.title, p.name as pillar,
             i.updated_at, '/ideas'::text as href
        from public.ideas i left join public.pillars p on p.id=i.pillar_id and p.owner_id=i.owner_id
       where i.owner_id=$1
      union all
      select d.id, 'post'::text as kind,
        case when pub.state='published' then 'published'
             when pub.state='uncertain' then 'uncertain'
             when pub.state='failed' then 'failed'
             when a.id is not null then 'approved'
             when d.status='legacy_published' then 'published'
             else d.status end as status,
        coalesce(nullif(d.title,''),left(v.text,80),'Untitled post') as title,
        p.name as pillar,d.updated_at,'/posts/' || d.id::text as href
        from public.drafts d
        left join public.pillars p on p.id=d.pillar_id and p.owner_id=d.owner_id
        left join lateral (select * from public.draft_versions v where v.draft_id=d.id and v.owner_id=$1 order by v.version_no desc limit 1) v on true
        left join public.approvals a on a.draft_version_id=v.id and a.owner_id=$1
        left join lateral (select state from public.publication_attempts x where x.approval_id=a.id and x.owner_id=$1 order by x.attempt_no desc limit 1) pub on true
       where d.owner_id=$1
    ) select * from items where ($2::text is null or status=$2)
      and ($3::text is null or title ilike '%' || $3 || '%')
      order by updated_at desc,id desc limit 200`,
    [ownerId,filter.status ?? null,filter.query?.trim() || null]
  );
  return result.rows;
}
