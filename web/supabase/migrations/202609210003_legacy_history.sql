alter table public.drafts drop constraint drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('draft','approved','published','discarded','legacy_published'));
alter table public.drafts add column legacy_post_url text;
