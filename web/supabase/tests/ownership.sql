begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@cadence.test', '', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@cadence.test', '', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into public.ideas (owner_id, title, status)
values ('11111111-1111-4111-8111-111111111111', 'A private idea', 'saved');
select is((select count(*)::int from public.ideas), 1, 'A can read own idea');
select is((select count(*)::int from public.ideas where title = 'A private idea'), 1, 'A can read title');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*)::int from public.ideas), 0, 'B cannot read A idea');
update public.ideas set title = 'Stolen' where title = 'A private idea';
select is((select count(*)::int from public.ideas where title = 'Stolen'), 0, 'B cannot update A idea');
select throws_ok(
  $$insert into public.ideas (owner_id, title, status) values ('11111111-1111-4111-8111-111111111111', 'Injected', 'saved')$$,
  '42501', null, 'B cannot create A idea'
);
select throws_ok(
  $$select count(*) from public.linkedin_connections$$,
  '42501', null, 'browser role cannot read encrypted connections'
);
select is(
  (select count(*)::int from information_schema.columns
   where table_schema='public' and table_name='creation_runs'
     and column_name in ('research_model','writing_model','ai_settings_revision')),
  3,
  'creation runs carry AI setting snapshots'
);
select is(has_table_privilege('authenticated','public.user_ai_settings','select'), false,
  'authenticated cannot read encrypted AI settings');
select is(has_table_privilege('authenticated','public.ai_validation_limits','select'), false,
  'authenticated cannot read validation counters');
select is(has_table_privilege('authenticated','public.linkedin_app_credentials','select'), false,
  'authenticated cannot read encrypted LinkedIn app credentials');
select is(
  (select count(*)::int from pg_catalog.pg_attribute
   where attrelid='public.linkedin_connections'::regclass
     and attname in ('client_id','scopes') and not attisdropped),
  2,
  'connections record which application issued the token');
select is(
  (select count(*)::int from pg_catalog.pg_attribute
   where attrelid='public.oauth_states'::regclass
     and attname='client_id' and not attisdropped),
  1,
  'oauth states record the application that began the flow');

select * from finish();
rollback;
