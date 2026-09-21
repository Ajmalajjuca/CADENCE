create table public.user_ai_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'anthropic' check (provider = 'anthropic'),
  api_key_encrypted text not null,
  key_suffix text not null check (length(key_suffix) = 4),
  research_model text not null,
  writing_model text not null,
  status text not null default 'valid' check (status in ('valid','invalid','unchecked')),
  revision integer not null default 1 check (revision > 0),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_validation_limits (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);

alter table public.creation_runs
  add column research_model text,
  add column writing_model text,
  add column ai_settings_revision integer check (ai_settings_revision is null or ai_settings_revision > 0);

alter table public.user_ai_settings enable row level security;
alter table public.ai_validation_limits enable row level security;

revoke all on public.user_ai_settings, public.ai_validation_limits from public, anon, authenticated;
