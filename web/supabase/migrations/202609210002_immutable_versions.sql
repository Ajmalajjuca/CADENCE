create or replace function public.reject_draft_version_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Draft versions are immutable; create a new version' using errcode = '23514';
end $$;

create trigger draft_versions_immutable_before_update
before update on public.draft_versions
for each row execute function public.reject_draft_version_update();
