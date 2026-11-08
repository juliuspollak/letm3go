-- Journey metadata v1. Journeys, activities, merges, splits, titles, types, tags,
-- stop corrections and the enrichment answers derived for them (places, rebuilt road
-- gaps, distance summaries) were one JSON blob in the device preferences file,
-- capped at 900 kB on the device and truncated to 300 kB in the settings backup.
-- They are now owner-scoped records: one row per decision, so renaming a journey on
-- one device is a single row update instead of a whole-blob overwrite, and two
-- devices editing different journeys can no longer erase each other.
--
-- The device keeps a mirror of these records plus a queue of record values. The
-- three functions at the end are the only way in or out, and they apply exactly the
-- same reducer the app runs locally (src/lib/journeyMetadata.js), so a replayed,
-- duplicated or reordered write converges instead of clobbering.
begin;

-- 1. The records. Every table is keyed by owner first, so an account's metadata can
--    be read, counted and deleted as a unit, and a row can never be addressed by a
--    reference alone.
create table if not exists public.journey_metadata_state (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 -- The moment enrichment started for this account: recordings that ended earlier are
 -- history and are never looked up. Decided once, then never moved.
 enrich_from bigint check (enrich_from is null or enrich_from > 0),
 revision integer not null default 1 check (revision > 0),
 updated_at timestamptz not null default now()
);

-- A title, a classification and the tags a person chose (or hid) for one recording.
-- A column left empty is a cleared answer, not a missing one: it is stored as null so
-- the value that arrives last wins without needing to know what it replaced.
create table if not exists public.journey_activity_metadata (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check (char_length(ref) between 1 and 80),
 title text check (title is null or char_length(title) between 1 and 150),
 type text check (type is null or type in ('Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Other','Unknown')),
 manual_tags text[] not null default '{}' check (cardinality(manual_tags) <= 20),
 hidden_tags text[] not null default '{}' check (cardinality(hidden_tags) <= 60),
 enriched_at bigint check (enriched_at is null or enriched_at > 0),
 updated_at timestamptz not null default now(),
 primary key (owner_id, ref)
);

-- A merge ('link'), a split ('cut') or a recording that two journeys share
-- ('source'). The pair is stored in a fixed order so "a then b" and "b then a" are
-- the same record, exactly as the app keys them.
create table if not exists public.journey_pair_metadata (
 owner_id uuid not null references auth.users(id) on delete cascade,
 relation text not null check (relation in ('link','cut','source')),
 left_id text not null check (char_length(left_id) between 1 and 80),
 right_id text not null check (char_length(right_id) between 1 and 80),
 updated_at timestamptz not null default now(),
 primary key (owner_id, relation, left_id, right_id),
 check (left_id < right_id)
);

-- A corrected stop: renamed, retagged, or hidden. The reference keeps the shape the
-- grouping screen uses ('dwell:<recording>:<time>', 'native:...' or a pair of
-- recording ids); the ids it encodes are derived, never stored a second time.
create table if not exists public.journey_stop_metadata (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check (char_length(ref) between 1 and 200),
 name text check (name is null or char_length(name) between 1 and 100),
 tags text[] not null default '{}' check (cardinality(tags) <= 20),
 replace_tags boolean not null default false,
 ignored boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (owner_id, ref),
 -- An edit with nothing left in it is a deletion, not a row.
 check (name is not null or cardinality(tags) > 0 or replace_tags or ignored)
);

-- 2. Derived enrichment. Never a decision: these three may be recomputed, and the
--    device mirror is allowed to drop the oldest of them when it fills the native
--    preference budget. Sizes are capped per record so one provider answer cannot
--    fill an account.
create table if not exists public.journey_place_metadata (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check (char_length(ref) between 1 and 40),
 lookup jsonb not null check (jsonb_typeof(lookup) = 'object' and octet_length(lookup::text) <= 20000),
 updated_at timestamptz not null default now(),
 primary key (owner_id, ref)
);

-- One reconstructed road for one GPS gap: '<recording>:<from>:<to>'.
create table if not exists public.journey_road_metadata (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check (char_length(ref) between 1 and 120),
 record jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 4000000),
 updated_at timestamptz not null default now(),
 primary key (owner_id, ref)
);

-- The distance a recording travelled once its gaps were rebuilt, kept so the list
-- never rescans a recording's GPS.
create table if not exists public.journey_distance_summary (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check (char_length(ref) between 1 and 80),
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 20000),
 updated_at timestamptz not null default now(),
 primary key (owner_id, ref)
);

-- Upgrade constraints as well when reapplying an earlier staging revision.
alter table public.journey_activity_metadata drop constraint if exists journey_activity_metadata_hidden_tags_check;
alter table public.journey_activity_metadata add constraint journey_activity_metadata_hidden_tags_check check (cardinality(hidden_tags)<=60);
alter table public.journey_road_metadata drop constraint if exists journey_road_metadata_record_check;
alter table public.journey_road_metadata add constraint journey_road_metadata_record_check check (jsonb_typeof(record)='object' and octet_length(record::text)<=4000000);

-- 3. Access. Owner only, and never while the account is awaiting deletion. The
--    functions below are security invoker, so these policies and the write guard
--    apply to every read and write they make.
do $$ declare table_name text; begin
 foreach table_name in array array['journey_metadata_state','journey_activity_metadata','journey_pair_metadata',
  'journey_stop_metadata','journey_place_metadata','journey_road_metadata','journey_distance_summary'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from anon,authenticated',table_name);
  execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
  execute format('grant all on public.%I to service_role',table_name);
  -- Re-applying an interrupted migration must not stop on a policy it already made.
  execute format('drop policy if exists %I on public.%I',table_name||'_owner',table_name);
  execute format('drop policy if exists account_active on public.%I',table_name);
  execute format('create policy %I_owner on public.%I for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))',table_name,table_name);
  execute format('create policy account_active on public.%I as restrictive for all to authenticated using ((select public.account_is_active())) with check ((select public.account_is_active()))',table_name);
  execute format('drop trigger if exists guard_owner_write on public.%I',table_name);
  execute format('create trigger guard_owner_write before insert or update on public.%I for each row execute function public.guard_owner_write(''owner_id'')',table_name);
 end loop;
end $$;

-- 4. Reads. A pull is one request, and the answer is the shape the grouping screen
--    already reads, so the app validates and renders it without a translation layer.
create or replace function public.journey_metadata_snapshot(p_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare state public.journey_metadata_state; result jsonb;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated journey metadata owner mismatch'; end if;
 select * into state from public.journey_metadata_state where owner_id=p_owner;
 -- A pair is stored once and is the same merge from either side; the app keys it on
 -- the sorted pair, so it is rebuilt in that same order.
 result:=jsonb_build_object(
  'version',1,'owner',p_owner,'history','[]'::jsonb,
  'links',coalesce((select jsonb_agg(format('[%s,%s]',to_jsonb(left_id),to_jsonb(right_id)) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and relation='link'),'[]'::jsonb),
  'cuts',coalesce((select jsonb_agg(format('[%s,%s]',to_jsonb(left_id),to_jsonb(right_id)) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and relation='cut'),'[]'::jsonb),
  'sourceLinks',coalesce((select jsonb_agg(jsonb_build_array(left_id,right_id) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and relation='source'),'[]'::jsonb),
  'titles',coalesce((select jsonb_object_agg(ref,title) from public.journey_activity_metadata
   where owner_id=p_owner and title is not null),'{}'::jsonb),
  'types',coalesce((select jsonb_object_agg(ref,type) from public.journey_activity_metadata
   where owner_id=p_owner and type is not null),'{}'::jsonb),
  'manualTags',coalesce((select jsonb_object_agg(ref,to_jsonb(manual_tags)) from public.journey_activity_metadata
   where owner_id=p_owner and cardinality(manual_tags)>0),'{}'::jsonb),
  'hiddenTags',coalesce((select jsonb_object_agg(ref,to_jsonb(hidden_tags)) from public.journey_activity_metadata
   where owner_id=p_owner and cardinality(hidden_tags)>0),'{}'::jsonb),
  'enriched',coalesce((select jsonb_object_agg(ref,to_jsonb(enriched_at)) from public.journey_activity_metadata
   where owner_id=p_owner and enriched_at is not null),'{}'::jsonb),
  'places',coalesce((select jsonb_object_agg(ref,lookup) from public.journey_place_metadata where owner_id=p_owner),'{}'::jsonb),
  'roads',coalesce((select jsonb_object_agg(ref,record) from public.journey_road_metadata where owner_id=p_owner),'{}'::jsonb),
  'distanceSummaries',coalesce((select jsonb_object_agg(ref,snapshot) from public.journey_distance_summary where owner_id=p_owner),'{}'::jsonb),
  -- An edit states what it changed; a flag that is off is absent, not false, so the
  -- value the app sees is the same whether it came from here or from a local edit.
  'stopEdits',coalesce((select jsonb_object_agg(ref,jsonb_strip_nulls(jsonb_build_object(
    'name',name,
    'tags',case when cardinality(tags)>0 then to_jsonb(tags) end,
    'replaceTags',case when replace_tags then 'true'::jsonb end,
    'ignored',case when ignored then 'true'::jsonb end)))
   from public.journey_stop_metadata where owner_id=p_owner),'{}'::jsonb),
  'enrichFrom',to_jsonb(state.enrich_from),
  'revision',to_jsonb(state.revision),
  'updatedAt',to_jsonb(state.updated_at)
 );
 return result;
end $$;
revoke all on function public.journey_metadata_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.journey_metadata_snapshot(uuid) to authenticated;

-- The cheap half of a pull: what revision the account is at, so a device that is
-- already up to date sends one number instead of downloading the grouping. Null
-- means nothing has ever been stored for this account.
create or replace function public.journey_metadata_revision(p_owner uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare saved integer;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated journey metadata owner mismatch'; end if;
 select revision into saved from public.journey_metadata_state where owner_id=p_owner;
 return saved;
end $$;
revoke all on function public.journey_metadata_revision(uuid) from public,anon,authenticated;
grant execute on function public.journey_metadata_revision(uuid) to authenticated;

-- 5. Writes. One call is one atomic change set: every record in it lands or none
--    does, and the revision moves once, so re-sending a queued value after a dropped
--    connection cannot create a second revision for the same edit. The answer is the
--    new revision plus the records this call replaced with a different value: two
--    devices that edited the same journey both learn that they did, instead of the
--    older answer disappearing without a word.
drop function if exists public.journey_apply_changes(uuid,jsonb,integer);
create function public.journey_apply_changes(p_owner uuid,p_changes jsonb,p_expected_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved integer; item jsonb; v_ref text; v_value jsonb;
 v_relation text; v_left text; v_right text; v_swap text;
 v_title text; v_type text; v_enriched bigint; v_tags text[]; v_hidden text[];
 v_name text; v_replace boolean; v_ignore boolean;
 v_overwritten jsonb:='[]'::jsonb;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated journey metadata owner mismatch'; end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Journey changes must be an object'; end if;
 -- A batch carries record values, so its size is bounded by one reasonable grouping,
 -- not by how long a device has been offline.
 if octet_length(p_changes::text)>6000000 then raise exception 'Journey changes are too large'; end if;
 if exists(select 1 from jsonb_object_keys(p_changes) as k(name)
   where k.name not in ('enrichFrom','activities','pairs','stops','places','roads','summaries')) then
  raise exception 'Unsupported journey change domain';
 end if;
 if exists(select 1 from jsonb_object_keys(p_changes) as k(name)
   where k.name<>'enrichFrom' and jsonb_typeof(p_changes->k.name)<>'array') then
  raise exception 'Journey change domains must be lists';
 end if;
 if jsonb_typeof(p_changes->'enrichFrom') not in ('number','null') then raise exception 'Invalid enrichment cutoff'; end if;
 -- The expected revision turns a simultaneous edit on another device into a visible
 -- conflict instead of a silent overwrite; the caller re-reads and re-sends once.
 select revision into saved from public.journey_metadata_state where owner_id=p_owner for update;
 if found then
  if p_expected_revision is not null and p_expected_revision<>saved then
   raise exception 'Journey information changed on another device; reload before saving again (conflict)';
  end if;
  -- The enrichment cutoff is decided once per account: a later device cannot move it.
  update public.journey_metadata_state
   set revision=revision+1,updated_at=now(),
    enrich_from=coalesce(enrich_from,case when jsonb_typeof(p_changes->'enrichFrom')='number'
     then floor((p_changes->>'enrichFrom')::numeric)::bigint end)
   where owner_id=p_owner returning revision into saved;
 else
  if p_expected_revision is not null then
   raise exception 'Journey information was removed on another device; reload before saving again (conflict)';
  end if;
  insert into public.journey_metadata_state(owner_id,enrich_from,revision)
   values(p_owner,case when jsonb_typeof(p_changes->'enrichFrom')='number'
    then floor((p_changes->>'enrichFrom')::numeric)::bigint end,1)
   returning revision into saved;
 end if;

 -- Titles, classifications and tags. A record is the whole value, so an answer that
 -- is cleared deletes the row rather than leaving a stale field behind.
 for item in select value from jsonb_array_elements(coalesce(p_changes->'activities','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid activity record'; end if;
  v_ref:=item->>'ref';
  if v_ref is null or char_length(v_ref) not between 1 and 80 then raise exception 'Invalid activity reference'; end if;
  if item->>'delete'='true' then
   delete from public.journey_activity_metadata where owner_id=p_owner and ref=v_ref;continue;
  end if;
  v_title:=case when jsonb_typeof(item->'title')='string' then item->>'title' end;
  if v_title is not null and char_length(v_title) not between 1 and 150 then raise exception 'Invalid journey title'; end if;
  v_type:=case when jsonb_typeof(item->'type')='string' then item->>'type' end;
  if v_type is not null and v_type not in ('Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Other','Unknown') then
   raise exception 'Unsupported journey activity type';
  end if;
  v_enriched:=case when jsonb_typeof(item->'enrichedAt')='number' then floor((item->>'enrichedAt')::numeric)::bigint end;
  if v_enriched is not null and v_enriched<=0 then v_enriched:=null; end if;
  select coalesce(array_agg(t.value order by t.ord),'{}') into v_tags
   from jsonb_array_elements_text(case when jsonb_typeof(item->'manualTags')='array' then item->'manualTags' else '[]'::jsonb end)
    with ordinality as t(value,ord)
   where t.value is not null and t.value<>'';
  select coalesce(array_agg(t.value order by t.ord),'{}') into v_hidden
   from jsonb_array_elements_text(case when jsonb_typeof(item->'hiddenTags')='array' then item->'hiddenTags' else '[]'::jsonb end)
    with ordinality as t(value,ord)
   where t.value is not null and t.value<>'';
  if cardinality(v_tags)>20 or cardinality(v_hidden)>60 then raise exception 'Too many journey tags'; end if;
  if exists(select 1 from unnest(v_tags) as t(tag) where char_length(t.tag)>60)
   or exists(select 1 from unnest(v_hidden) as t(tag) where char_length(t.tag)>60) then raise exception 'Invalid journey tag'; end if;
  if v_title is null and v_type is null and v_enriched is null and cardinality(v_tags)=0 and cardinality(v_hidden)=0 then
   delete from public.journey_activity_metadata where owner_id=p_owner and ref=v_ref;
  else
   -- A different value already stored means another device answered the same question.
   if exists(select 1 from public.journey_activity_metadata where owner_id=p_owner and ref=v_ref
    and row(title,type,manual_tags,hidden_tags,enriched_at)
     is distinct from row(v_title,v_type,v_tags,v_hidden,v_enriched)) then
    v_overwritten:=v_overwritten||jsonb_build_array(jsonb_build_object('domain','activities','ref',v_ref));
   end if;
   insert into public.journey_activity_metadata(owner_id,ref,title,type,manual_tags,hidden_tags,enriched_at)
    values(p_owner,v_ref,v_title,v_type,v_tags,v_hidden,v_enriched)
   on conflict (owner_id,ref) do update set title=excluded.title,type=excluded.type,manual_tags=excluded.manual_tags,
    hidden_tags=excluded.hidden_tags,enriched_at=excluded.enriched_at,updated_at=now();
  end if;
 end loop;

 -- Merges, splits and shared recordings. Undoing one deletes the pair, so a split is
 -- the absence of a merge and the two can never disagree.
 for item in select value from jsonb_array_elements(coalesce(p_changes->'pairs','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid journey pair'; end if;
  v_relation:=item->>'relation';v_left:=item->>'left';v_right:=item->>'right';
  if v_relation is null or v_relation not in ('link','cut','source') then raise exception 'Invalid journey pair relation'; end if;
  if v_left is null or v_right is null or v_left=v_right
   or char_length(v_left) not between 1 and 80 or char_length(v_right) not between 1 and 80 then
   raise exception 'Invalid journey pair';
  end if;
  if v_left>v_right then v_swap:=v_left;v_left:=v_right;v_right:=v_swap;end if;
  if item->>'delete'='true' then
   delete from public.journey_pair_metadata where owner_id=p_owner and relation=v_relation and left_id=v_left and right_id=v_right;
  else
   if v_relation in ('link','cut') then
    delete from public.journey_pair_metadata where owner_id=p_owner and left_id=v_left and right_id=v_right
     and relation in ('link','cut') and relation<>v_relation;
   end if;
   insert into public.journey_pair_metadata(owner_id,relation,left_id,right_id) values(p_owner,v_relation,v_left,v_right)
   on conflict (owner_id,relation,left_id,right_id) do update set updated_at=now();
  end if;
 end loop;

 -- Stop corrections. rename, retag, or hide; an edit that ends up empty is removed,
 -- which is what undoing the correction means.
 for item in select value from jsonb_array_elements(coalesce(p_changes->'stops','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid stop edit'; end if;
  v_ref:=item->>'ref';
  if v_ref is null or char_length(v_ref) not between 1 and 200 then raise exception 'Invalid stop reference'; end if;
  v_name:=case when jsonb_typeof(item->'name')='string' then item->>'name' end;
  if v_name is not null and char_length(v_name) not between 1 and 100 then raise exception 'Invalid stop name'; end if;
  select coalesce(array_agg(t.value order by t.ord),'{}') into v_tags
   from jsonb_array_elements_text(case when jsonb_typeof(item->'tags')='array' then item->'tags' else '[]'::jsonb end)
    with ordinality as t(value,ord)
   where t.value is not null and t.value<>'';
  if cardinality(v_tags)>20 then raise exception 'Too many stop tags'; end if;
  if exists(select 1 from unnest(v_tags) as t(tag) where char_length(t.tag)>60) then raise exception 'Invalid stop tag'; end if;
  v_replace:=coalesce(item->>'replaceTags','false')='true';v_ignore:=coalesce(item->>'ignored','false')='true';
  if item->>'delete'='true' or (v_name is null and cardinality(v_tags)=0 and not v_replace and not v_ignore) then
   delete from public.journey_stop_metadata where owner_id=p_owner and ref=v_ref;
  else
   if exists(select 1 from public.journey_stop_metadata where owner_id=p_owner and ref=v_ref
    and row(name,tags,replace_tags,ignored) is distinct from row(v_name,v_tags,v_replace,v_ignore)) then
    v_overwritten:=v_overwritten||jsonb_build_array(jsonb_build_object('domain','stops','ref',v_ref));
   end if;
   insert into public.journey_stop_metadata(owner_id,ref,name,tags,replace_tags,ignored)
    values(p_owner,v_ref,v_name,v_tags,v_replace,v_ignore)
   on conflict (owner_id,ref) do update set name=excluded.name,tags=excluded.tags,
    replace_tags=excluded.replace_tags,ignored=excluded.ignored,updated_at=now();
  end if;
 end loop;

 -- Derived enrichment. Stored as the provider's answer, verbatim, so it can be read
 -- back and reused without asking the provider again; a batch may also delete it.
 for item in select value from jsonb_array_elements(coalesce(p_changes->'places','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid place record'; end if;
  v_ref:=item->>'ref';
  if v_ref is null or char_length(v_ref) not between 1 and 40 then raise exception 'Invalid place reference'; end if;
  if item->>'delete'='true' then
   delete from public.journey_place_metadata where owner_id=p_owner and ref=v_ref;
  else
   v_value:=item->'lookup';
   if jsonb_typeof(v_value)<>'object' then raise exception 'Invalid place answer'; end if;
   if exists(select 1 from public.journey_place_metadata where owner_id=p_owner and ref=v_ref
    and lookup is distinct from v_value) then
    v_overwritten:=v_overwritten||jsonb_build_array(jsonb_build_object('domain','places','ref',v_ref));
   end if;
   insert into public.journey_place_metadata(owner_id,ref,lookup) values(p_owner,v_ref,v_value)
   on conflict (owner_id,ref) do update set lookup=excluded.lookup,updated_at=now();
  end if;
 end loop;

 for item in select value from jsonb_array_elements(coalesce(p_changes->'roads','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid road record'; end if;
  v_ref:=item->>'ref';
  if v_ref is null or char_length(v_ref) not between 1 and 120 then raise exception 'Invalid road reference'; end if;
  if item->>'delete'='true' then
   delete from public.journey_road_metadata where owner_id=p_owner and ref=v_ref;
  else
   v_value:=item->'record';
   if jsonb_typeof(v_value)<>'object' then raise exception 'Invalid road answer'; end if;
   if exists(select 1 from public.journey_road_metadata where owner_id=p_owner and ref=v_ref
    and record is distinct from v_value) then
    v_overwritten:=v_overwritten||jsonb_build_array(jsonb_build_object('domain','roads','ref',v_ref));
   end if;
   insert into public.journey_road_metadata(owner_id,ref,record) values(p_owner,v_ref,v_value)
   on conflict (owner_id,ref) do update set record=excluded.record,updated_at=now();
  end if;
 end loop;

 for item in select value from jsonb_array_elements(coalesce(p_changes->'summaries','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid distance summary'; end if;
  v_ref:=item->>'ref';
  if v_ref is null or char_length(v_ref) not between 1 and 80 then raise exception 'Invalid distance summary reference'; end if;
  if item->>'delete'='true' then
   delete from public.journey_distance_summary where owner_id=p_owner and ref=v_ref;
  else
   v_value:=item->'snapshot';
   if jsonb_typeof(v_value)<>'object' then raise exception 'Invalid distance summary answer'; end if;
   if exists(select 1 from public.journey_distance_summary where owner_id=p_owner and ref=v_ref
    and snapshot is distinct from v_value) then
    v_overwritten:=v_overwritten||jsonb_build_array(jsonb_build_object('domain','summaries','ref',v_ref));
   end if;
   insert into public.journey_distance_summary(owner_id,ref,snapshot) values(p_owner,v_ref,v_value)
   on conflict (owner_id,ref) do update set snapshot=excluded.snapshot,updated_at=now();
  end if;
 end loop;
 return jsonb_build_object('revision',saved,'overwritten',v_overwritten);
end $$;
revoke all on function public.journey_apply_changes(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.journey_apply_changes(uuid,jsonb,integer) to authenticated;

-- During rollout an old settings backup may still be the only journey copy.
-- A settings-only upload from a new device must not erase it before migration.
create or replace function public.protect_account_settings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id<>old.owner_id then raise exception 'Owner is immutable'; end if;
 if old.payload ? 'journeyGrouping' and not (new.payload ? 'journeyGrouping') then
  new.payload:=new.payload||jsonb_build_object('journeyGrouping',old.payload->'journeyGrouping');
 end if;
 new.revision:=old.revision+1;
 new.updated_at:=now();
 return new;
end $$;

commit;
