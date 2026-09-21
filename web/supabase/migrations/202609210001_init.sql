create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', work text not null default '', location text not null default '',
  audience text not null default '', goal text not null default '',
  onboarding_step integer not null default 0 check (onboarding_step between 0 and 6),
  onboarding_complete boolean not null default false,
  voice_traits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pillars (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null, position integer not null default 0, is_primary boolean not null default false,
  created_at timestamptz not null default now(), unique(owner_id, name)
);
create table public.voice_rules (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  length_preference text not null default '', casing text not null default '', hashtags text not null default '',
  emoji text not null default '', cta text not null default '', banned_terms text[] not null default '{}',
  notes text not null default '', revision integer not null default 1, updated_at timestamptz not null default now()
);
create table public.writing_samples (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0), source text not null default 'pasted',
  sample_date date, performance_note text not null default '', created_at timestamptz not null default now()
);
create table public.stories (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '', details text not null check (length(btrim(details)) > 0),
  usage_note text not null default '', created_at timestamptz not null default now()
);
create table public.ideas (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0), pillar_id uuid references public.pillars(id) on delete set null,
  angle text not null default '', origin text not null default 'user', why_now text not null default '',
  status text not null default 'saved' check (status in ('saved','in_progress','used','discarded')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.research_sources (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid references public.ideas(id) on delete set null,
  url text not null, title text not null default '', published_at timestamptz, claim_note text not null default '',
  created_at timestamptz not null default now()
);
create table public.creation_runs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'post' check (kind in ('post','revision')),
  mode text not null check (mode in ('quick','guided')),
  entry text not null check (entry in ('topic','find','surprise','revision')),
  topic text not null default '', direction text not null default '', idea_id uuid references public.ideas(id) on delete set null,
  draft_id uuid, selected_idea jsonb, selected_hook jsonb,
  stage text not null default 'idea' check (stage in ('idea','research','hooks','draft','style','revision','ready')),
  status text not null default 'queued' check (status in ('queued','running','waiting_for_user','failed','complete')),
  stages jsonb not null default '{}'::jsonb, prompt_version text not null default 'cadence-v1',
  model text not null default '', usage jsonb not null default '{}'::jsonb,
  error_code text, error_message text,
  attempts integer not null default 0 check (attempts >= 0), lease_owner text, lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.drafts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid references public.ideas(id) on delete set null, creation_run_id uuid references public.creation_runs(id) on delete set null,
  title text not null default '', pillar_id uuid references public.pillars(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','approved','published','discarded')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.creation_runs add constraint creation_runs_draft_id_fkey foreign key (draft_id) references public.drafts(id) on delete set null;
create table public.draft_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid not null references public.drafts(id) on delete cascade,
  version_no integer not null check (version_no > 0), text text not null check (length(btrim(text)) > 0),
  hook text not null default '', source_refs jsonb not null default '[]'::jsonb,
  prompt_version text, model text, created_at timestamptz not null default now(),
  unique(draft_id, version_no)
);
create table public.approvals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  draft_version_id uuid not null unique references public.draft_versions(id) on delete cascade,
  text_checksum text not null check (length(text_checksum) = 64), approved_at timestamptz not null default now()
);
create table public.linkedin_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  person_urn text not null, access_token_encrypted text not null,
  expires_at timestamptz, status text not null default 'connected' check (status in ('connected','expired','revoked')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.oauth_states (
  state_hash text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table public.publication_attempts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  approval_id uuid not null references public.approvals(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0), request_key uuid not null default gen_random_uuid(),
  state text not null default 'pending' check (state in ('pending','published','failed','uncertain')),
  linkedin_post_urn text, linkedin_post_url text, error_code text, error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(approval_id, attempt_no), unique(request_key)
);
create unique index publication_one_active_approval on public.publication_attempts(approval_id)
  where state in ('pending','uncertain','published');
create table public.activity_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null, related_id uuid, detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ideas_owner_status_created on public.ideas(owner_id,status,created_at desc);
create index runs_owner_status_created on public.creation_runs(owner_id,status,created_at desc);
create index drafts_owner_status_created on public.drafts(owner_id,status,created_at desc);
create index versions_draft_version on public.draft_versions(draft_id,version_no desc);
create index attempts_owner_state_created on public.publication_attempts(owner_id,state,created_at desc);
create index events_owner_created on public.activity_events(owner_id,created_at desc);

do $$
declare t text;
begin
  foreach t in array array['profiles','pillars','voice_rules','writing_samples','stories','ideas','research_sources','creation_runs','drafts','draft_versions','approvals','linkedin_connections','oauth_states','publication_attempts','activity_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete_own on public.profiles for delete to authenticated using (user_id = (select auth.uid()));
create policy rules_select_own on public.voice_rules for select to authenticated using (owner_id = (select auth.uid()));
create policy rules_insert_own on public.voice_rules for insert to authenticated with check (owner_id = (select auth.uid()));
create policy rules_update_own on public.voice_rules for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy rules_delete_own on public.voice_rules for delete to authenticated using (owner_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['pillars','writing_samples','stories','ideas'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
  foreach t in array array['research_sources','creation_runs','drafts','draft_versions','activity_events'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
  end loop;
end $$;

-- These records are written only by trusted server code after ownership and state checks.
create policy approvals_select_own on public.approvals for select to authenticated using (owner_id = (select auth.uid()));
create policy attempts_select_own on public.publication_attempts for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.linkedin_connections, public.oauth_states from anon, authenticated;
revoke insert, update, delete on public.approvals, public.publication_attempts from anon, authenticated;

create or replace function public.claim_creation_run(p_worker_id text)
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
revoke all on function public.claim_creation_run(text) from public, anon, authenticated;
grant execute on function public.claim_creation_run(text) to service_role;
