-- Accept Gym in private journey classifications without changing existing rows.
begin;
alter table public.journey_activity_metadata drop constraint journey_activity_metadata_type_check;
alter table public.journey_activity_metadata add constraint journey_activity_metadata_type_check check (type is null or type in ('Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Gym','Other','Unknown'));

create or replace function public.journey_apply_changes(p_owner uuid,p_changes jsonb,p_expected_revision integer default null)
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
  if v_type is not null and v_type not in ('Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Gym','Other','Unknown') then
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

commit;
