-- Runs in CI against the real Supabase stack: real storage.objects, real
-- realtime.messages and their real policies, on a throwaway database. Everything
-- here rolls back. A failed expectation stops the job.
begin;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','a@example.test'),
 ('22222222-2222-4222-8222-222222222222','b@example.test');
insert into public.feedback(id,client_token,owner_id,category,description) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','bug','x'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','bug','y');
insert into public.households(id,name) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Home');
insert into public.household_memberships(user_id,household_id,role) values('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','owner');

create function pg_temp.as_user(u uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true),set_config('request.jwt.claim.sub',u::text,true)
$$;
create function pg_temp.refused(q text) returns void language plpgsql as $$
begin
 begin execute q; exception when insufficient_privilege then return; end;
 raise exception 'expected refusal: %',q;
end $$;

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
-- Own ticket, well-formed key: allowed.
insert into storage.objects(bucket_id,name) values('feedback-attachments','11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg');
-- No ticket, arbitrary name, and someone else's ticket or folder: refused.
select pg_temp.refused($$insert into storage.objects(bucket_id,name) values('feedback-attachments','11111111-1111-4111-8111-111111111111/loose.jpg')$$);
select pg_temp.refused($$insert into storage.objects(bucket_id,name) values('feedback-attachments','11111111-1111-4111-8111-111111111111/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg')$$);
select pg_temp.refused($$insert into storage.objects(bucket_id,name) values('feedback-attachments','11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg')$$);
select pg_temp.refused($$insert into storage.objects(bucket_id,name) values('feedback-attachments','22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg')$$);
-- Realtime: a member reads, cannot write.
select set_config('realtime.topic','household:cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
do $$ begin
 if not public.can_join_household_topic(realtime.topic()) then raise exception 'member should be able to join'; end if;
 if public.can_join_household_topic('household:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'another household must stay closed'; end if;
end $$;
select pg_temp.refused($$insert into realtime.messages(topic,extension,event,payload) values(realtime.topic(),'broadcast','location','{}')$$);
reset role;

select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
set local role authenticated;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='feedback-attachments' and name like '11111111%') then raise exception 'another account read a photo'; end if;
 if public.can_join_household_topic('household:cccccccc-cccc-4ccc-8ccc-cccccccccccc') then raise exception 'non-member joined a household channel'; end if;
end $$;
reset role;
-- A real broadcast from a real publish path, with an empty payload.
update public.household_live_locations set enabled=enabled where false;
insert into public.household_live_locations(user_id,enabled,latitude,longitude,location_at) values('11111111-1111-4111-8111-111111111111',true,-33.8,151.2,now());
do $$ begin
 if not exists(select 1 from realtime.messages where topic='household:cccccccc-cccc-4ccc-8ccc-cccccccccccc' and event='location' and payload-'id'-'event'-'meta'='{}'::jsonb) then
  raise exception 'no empty signal reached realtime.messages: %',(select json_agg(payload) from realtime.messages);
 end if;
end $$;
rollback;
\echo real-storage-realtime checks passed
