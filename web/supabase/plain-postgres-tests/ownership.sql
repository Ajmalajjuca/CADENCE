begin;
grant all on all tables in schema public to authenticated;
revoke all on public.user_ai_settings, public.ai_validation_limits from authenticated;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@cadence.test','',now(),now()),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@cadence.test','',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.ideas(owner_id,title) values ('11111111-1111-4111-8111-111111111111','Private A idea');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
begin
 if (select count(*) from public.ideas) <> 0 then raise exception 'B read A idea'; end if;
 update public.ideas set title='Stolen' where title='Private A idea';
 if found then raise exception 'B updated A idea'; end if;
 begin
   insert into public.ideas(owner_id,title) values ('11111111-1111-4111-8111-111111111111','Injected');
   raise exception 'B inserted an idea for A';
 exception when insufficient_privilege then null; end;
 begin
   update public.draft_versions set text='changed';
   if found then raise exception 'direct immutable version update succeeded'; end if;
 exception when insufficient_privilege then null; end;
 begin
   perform * from public.user_ai_settings;
   raise exception 'browser role read private AI settings';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.creation_runs(owner_id,mode,entry)
values ('11111111-1111-4111-8111-111111111111','quick','surprise');
do $$
declare first_run public.creation_runs; second_run public.creation_runs;
begin
 select * into first_run from public.claim_creation_run_v2('worker-a');
 select * into second_run from public.claim_creation_run_v2('worker-b');
 if first_run.id is null or second_run.id is not null then raise exception 'claim collision'; end if;
end $$;
rollback;
