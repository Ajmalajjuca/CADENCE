create or replace function public.claim_creation_run_v2(p_worker_id text)
returns setof public.creation_runs
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with picked as (
    select id from public.creation_runs
    where (status = 'queued' or (status = 'running' and lease_until < now()))
      and attempts < 5
    order by created_at
    for update skip locked limit 1
  )
  update public.creation_runs r
  set status = 'running', attempts = r.attempts + 1,
      lease_owner = p_worker_id, lease_until = now() + interval '2 minutes', updated_at = now()
  from picked where r.id = picked.id
  returning r.*;
end $$;

revoke all on function public.claim_creation_run_v2(text) from public, anon, authenticated;
grant execute on function public.claim_creation_run_v2(text) to service_role;

-- Fence worker processes from revisions that used the original claim contract.
create or replace function public.claim_creation_run(p_worker_id text)
returns setof public.creation_runs
language plpgsql security definer set search_path = public
as $$
begin
  return;
end $$;
