-- Each user brings their own LinkedIn application. The secret is owner-bound
-- ciphertext no browser role may read; the client id is public by nature and
-- travels in the authorization URL.
create table public.linkedin_app_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null,
  client_secret_encrypted text not null,
  secret_suffix text not null,
  status text not null default 'unchecked' check (status in ('unchecked','valid','invalid')),
  revision integer not null default 1,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkedin_app_credentials enable row level security;
revoke all on public.linkedin_app_credentials from public, anon, authenticated;

-- Which application issued a token, and what it was granted. Nullable: a row
-- restored from a pre-migration backup has neither.
alter table public.linkedin_connections add column client_id text;
alter table public.linkedin_connections add column scopes text;

-- Which application began a flow, so a callback cannot exchange a code against
-- an application the user did not authorize.
alter table public.oauth_states add column client_id text;

-- Every existing token was issued by the central application and is encrypted
-- without owner binding, so it can neither be decrypted nor legitimately used
-- after this change. Publication history is untouched; every user reconnects.
delete from public.linkedin_connections;
