-- Selective runtime reads. The no-argument snapshot remains for verified legacy
-- import only. This migration is proposed; never apply to production implicitly.
begin;
create index if not exists activities_owner_started_id on public.activities(owner_id,started_at desc,id desc);
create index if not exists activities_owner_text_ref on public.activities(owner_id,(id::text));
create table if not exists public.journey_metadata_changes (
 owner_id uuid not null references auth.users(id) on delete cascade,
 domain text not null,ref text not null,revision integer not null,deleted boolean not null,
 primary key(owner_id,domain,ref)
);
alter table public.journey_metadata_changes enable row level security;
revoke all on public.journey_metadata_changes from anon,authenticated;
grant select on public.journey_metadata_changes to authenticated;
grant all on public.journey_metadata_changes to service_role;
drop policy if exists journey_changes_owner on public.journey_metadata_changes;
create policy journey_changes_owner on public.journey_metadata_changes to authenticated using(owner_id=(select auth.uid()));
drop policy if exists account_active on public.journey_metadata_changes;
create policy account_active on public.journey_metadata_changes as restrictive to authenticated using((select public.account_is_active()));
create index if not exists journey_changes_revision on public.journey_metadata_changes(owner_id,revision);
create or replace function public.note_journey_metadata_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; who uuid; key text; rev integer;
begin
 if TG_OP='DELETE' then item:=to_jsonb(old);else item:=to_jsonb(new);end if;
 who:=(item->>'owner_id')::uuid;
 select revision into rev from public.journey_metadata_state where owner_id=who;
 if rev is null then return null;end if;
 key:=coalesce(item->>'ref',jsonb_build_array(item->>'relation',item->>'left_id',item->>'right_id')::text);
 insert into public.journey_metadata_changes(owner_id,domain,ref,revision,deleted)
 values(who,TG_ARGV[0],key,rev,TG_OP='DELETE')
 on conflict(owner_id,domain,ref) do update set revision=excluded.revision,deleted=excluded.deleted;
 return null;
end $$;
revoke all on function public.note_journey_metadata_change() from public,anon,authenticated;
do $$ declare t text; d text;begin
 for t,d in select * from (values ('journey_activity_metadata','activities'),('journey_pair_metadata','pairs'),('journey_stop_metadata','stops'),('journey_place_metadata','places'),('journey_road_metadata','roads'),('journey_distance_summary','summaries')) v(t,d) loop
 execute format('drop trigger if exists journey_change on public.%I',t);
 execute format('create trigger journey_change after insert or update or delete on public.%I for each row execute function public.note_journey_metadata_change(%L)',t,d);
 end loop;
end $$;
alter table public.journey_distance_summary drop constraint if exists journey_distance_summary_snapshot_check;
alter table public.journey_distance_summary add constraint journey_distance_summary_snapshot_check check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=400000);
create or replace function public.note_journey_activity_change() returns trigger language plpgsql security definer set search_path='' as $$
declare who uuid; identity text; rev integer;
begin
 if TG_OP='DELETE' then who:=old.owner_id;identity:=old.id::text;else who:=new.owner_id;identity:=new.id::text;end if;
 if not exists(select 1 from auth.users where id=who) then return null;end if;
 insert into public.journey_metadata_state(owner_id,revision) values(who,1) on conflict(owner_id) do update set revision=journey_metadata_state.revision+1,updated_at=now() returning revision into rev;
 insert into public.journey_metadata_changes(owner_id,domain,ref,revision,deleted) values(who,coalesce(TG_ARGV[0],'activityRows'),identity,rev,TG_OP='DELETE') on conflict(owner_id,domain,ref) do update set revision=excluded.revision,deleted=excluded.deleted;
 if TG_OP='DELETE' and TG_TABLE_NAME='activities' then
  delete from public.journey_stop_metadata where owner_id=who and (left(ref,length(identity)+7)='native:'||identity||':' or left(ref,length(identity)+6)='dwell:'||identity||':' or position(to_jsonb(identity)::text in ref)>0);
  delete from public.journey_pair_metadata where owner_id=who and (left_id=identity or right_id=identity);
  delete from public.journey_activity_metadata where owner_id=who and ref=identity;
  delete from public.journey_road_metadata where owner_id=who and left(ref,length(identity)+1)=identity||':';
  delete from public.journey_distance_summary where owner_id=who and ref=identity;
 end if;
 return null;
end $$;
revoke all on function public.note_journey_activity_change() from public,anon,authenticated;
drop trigger if exists journey_activity_change on public.activities;
create trigger journey_activity_change after insert or update or delete on public.activities for each row execute function public.note_journey_activity_change();
drop trigger if exists journey_saved_place_change on public.saved_places;
create trigger journey_saved_place_change after insert or update or delete on public.saved_places for each row execute function public.note_journey_activity_change('savedPlaces');
create or replace function public.note_journey_media_change() returns trigger language plpgsql security definer set search_path='' as $$
declare who uuid; activity uuid; rev integer;
begin
 if TG_OP='DELETE' then who:=old.owner_id;activity:=old.activity_id;else who:=new.owner_id;activity:=new.activity_id;end if;
 if not exists(select 1 from auth.users where id=who) then return null;end if;
 insert into public.journey_metadata_state(owner_id,revision) values(who,1) on conflict(owner_id) do update set revision=journey_metadata_state.revision+1,updated_at=now() returning revision into rev;
 insert into public.journey_metadata_changes(owner_id,domain,ref,revision,deleted) values(who,'activityRows',activity::text,rev,false) on conflict(owner_id,domain,ref) do update set revision=excluded.revision,deleted=false;
 return null;
end $$;
revoke all on function public.note_journey_media_change() from public,anon,authenticated;
drop trigger if exists journey_media_change on public.media_assets;
create trigger journey_media_change after insert or update or delete on public.media_assets for each row execute function public.note_journey_media_change();
create or replace function public.journey_metadata_snapshot(p_owner uuid,p_refs text[],p_detail_refs text[] default '{}',p_since_revision integer default null,p_cursor text default null,p_at_revision integer default null,p_limit integer default 500,p_place_refs text[] default '{}',p_list boolean default false,p_from timestamptz default null,p_to timestamptz default null,p_before timestamptz default null,p_before_id uuid default null,p_query text default '',p_activity text default null,p_sort text default 'newest',p_before_metric numeric default null,p_geometry boolean default false,p_equipment text default null,p_favourite_refs text[] default null,p_archived_refs text[] default '{}',p_show_archived boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare state public.journey_metadata_state; result jsonb; refs text[]; expanded text[]; previous integer:=0;
 changes jsonb; next_cursor text; changes_more boolean; head integer; detail_places text[]; page_refs text[]; next_activity jsonb; page jsonb;

begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated journey metadata owner mismatch'; end if;

 if cardinality(p_place_refs)>200 or cardinality(p_refs)>200 or cardinality(p_detail_refs)>50 or p_limit is null or p_limit not between 1 and 500 then raise exception 'Journey scope is too large'; end if;
 select * into state from public.journey_metadata_state where owner_id=p_owner;
 head:=coalesce(least(p_at_revision,state.revision),state.revision);
 refs:=coalesce(p_refs,'{}');
 if p_list then
  if p_sort not in ('newest','distance','duration') or length(p_query)>200 then raise exception 'Invalid activity page';end if;
  select coalesce(jsonb_agg(row order by metric desc,started_at desc,id desc),'[]') into page from (
   select jsonb_build_object('id',a.id,'at',a.started_at,'metric',case p_sort when 'distance' then case when jsonb_typeof(d.snapshot->'summary'->'estimatedMeters')='number' then (d.snapshot->'summary'->>'estimatedMeters')::numeric else a.distance_meters end when 'duration' then a.duration_seconds else 0 end) row,
    a.id,a.started_at,case p_sort when 'distance' then case when jsonb_typeof(d.snapshot->'summary'->'estimatedMeters')='number' then (d.snapshot->'summary'->>'estimatedMeters')::numeric else a.distance_meters end when 'duration' then a.duration_seconds else 0 end metric
   from public.activities a left join public.journey_activity_metadata m on m.owner_id=a.owner_id and m.ref=a.id::text
   left join public.journey_distance_summary d on d.owner_id=a.owner_id and d.ref=a.id::text
   where a.owner_id=p_owner
    and (p_favourite_refs is null or a.id::text=any(p_favourite_refs))
    and (p_show_archived or not a.id::text=any(p_archived_refs))
    and (not p_show_archived or a.id::text=any(p_archived_refs))
    and (p_equipment is null or exists(select 1 from jsonb_array_elements(a.equipment) e where e->>'id'=p_equipment)
     or a.vehicle=(select name from public.collection_items where owner_id=p_owner and id::text=p_equipment))
    and ((p_from is null or a.ended_at>=p_from) and (p_to is null or a.started_at<p_to)
     or exists(select 1 from public.journey_pair_metadata p join public.activities b on b.owner_id=p_owner and b.id::text=case when p.left_id=a.id::text then p.right_id else p.left_id end
      where p.owner_id=p_owner and p.relation='link' and (p.left_id=a.id::text or p.right_id=a.id::text)
       and (p_from is null or greatest(a.ended_at,b.ended_at)>=p_from) and (p_to is null or least(a.started_at,b.started_at)<p_to)))
    and (p_activity is null or coalesce(m.type,a.activity)=p_activity)
    and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',a.title,a.notes,a.collection,array_to_string(a.tags,' '),m.title,array_to_string(m.manual_tags,' '),d.snapshot->'presentation'->>'location',d.snapshot->'presentation'->>'title',(d.snapshot->'presentation'->'tags')::text)))>0
     or exists(select 1 from public.journey_stop_metadata st where st.owner_id=p_owner and (left(st.ref,length(a.id::text)+7)='native:'||a.id::text||':' or left(st.ref,length(a.id::text)+6)='dwell:'||a.id::text||':') and position(lower(p_query) in lower(concat_ws(' ',st.name,array_to_string(st.tags,' '))))>0))
    and (p_before is null or (case p_sort when 'distance' then case when jsonb_typeof(d.snapshot->'summary'->'estimatedMeters')='number' then (d.snapshot->'summary'->>'estimatedMeters')::numeric else a.distance_meters end when 'duration' then a.duration_seconds else 0 end,a.started_at,a.id)<(coalesce(p_before_metric,0),p_before,p_before_id))
   order by metric desc,a.started_at desc,a.id desc limit 51
  ) rows;
  if jsonb_array_length(page)>50 then next_activity:=page->49;end if;
  select coalesce(array_agg(value->>'id' order by ord),'{}') into page_refs from jsonb_array_elements(page) with ordinality t(value,ord) where ord<=50;
  refs:=page_refs;
 end if;
 -- Close explicit relationships and a conservative superset of possible automatic
 -- drive continuations. Time context is independent of pagination or calendar date.
 loop
  previous:=cardinality(refs);
  select coalesce(array_agg(distinct id),'{}') into expanded from (
   select unnest(refs) id
   union select substring(id from 8) from unnest(refs) id where left(id,7)='linked:'
   union select 'linked:'||a.id::text from public.activities a where a.owner_id=p_owner and a.recording_mode='tesla' and a.id::text=any(refs)
   union select p.left_id from public.journey_pair_metadata p where p.owner_id=p_owner and p.relation in ('link','source') and p.right_id=any(refs)
   union select p.right_id from public.journey_pair_metadata p where p.owner_id=p_owner and p.relation in ('link','source') and p.left_id=any(refs)
   union select b.id::text from public.activities a join public.activities b on b.owner_id=a.owner_id
    and (a.recording_mode='tesla')<>(b.recording_mode='tesla')
    and b.started_at<=a.ended_at and a.started_at<=b.ended_at
    where a.owner_id=p_owner and a.id::text=any(refs)
   union
   select n.id::text from public.activities a
   cross join lateral (
    (select b.* from public.activities b where b.owner_id=p_owner and b.activity in ('Driving','Unknown') and (b.started_at,b.id)<(a.started_at,a.id) order by b.started_at desc,b.id desc limit 1)
    union all
    (select b.* from public.activities b where b.owner_id=p_owner and b.activity in ('Driving','Unknown') and (b.started_at,b.id)>(a.started_at,a.id) order by b.started_at,b.id limit 1)
   ) n
   where a.owner_id=p_owner and a.id::text=any(refs) and a.activity in ('Driving','Unknown') and n.activity in ('Driving','Unknown')
    and greatest(a.started_at,n.started_at)-least(a.ended_at,n.ended_at) between interval '0 seconds' and interval '6 hours'
  ) related;
  refs:=expanded;
  if cardinality(refs)>1000 then raise exception 'Journey context exceeds 1000 recordings. Grouping cannot be shown completely for this scope.'; end if;
  exit when cardinality(refs)=previous;
 end loop;
 -- Only detail requests inspect GPS coordinates to find their saved POI records.
 select coalesce(array_agg(distinct place_key),'{}') into detail_places from (
  select to_char((p->>'latitude')::numeric,'FM990.0000')||','||to_char((p->>'longitude')::numeric,'FM990.0000') place_key
  from public.activities a cross join lateral jsonb_array_elements(a.route_points) p
  where a.owner_id=p_owner and p_geometry and a.id::text=any(p_detail_refs)
 ) keys;
 select coalesce(jsonb_agg(jsonb_build_object('domain',domain,'ref',ref,'deleted',deleted,'revision',revision) order by key),'[]'),
  case when count(*)>p_limit then true else false end into changes,changes_more
 from (select *,domain||'|'||ref key from public.journey_metadata_changes
  where owner_id=p_owner and p_since_revision is not null and revision>p_since_revision and revision<=head
   and (p_cursor is null or domain||'|'||ref>p_cursor) order by domain||'|'||ref limit p_limit+1) page;
 if changes_more then changes:= (select jsonb_agg(value order by ord) from jsonb_array_elements(changes) with ordinality t(value,ord) where ord<=p_limit); end if;
 if changes_more then next_cursor:=(changes->(jsonb_array_length(changes)-1)->>'domain')||'|'||(changes->(jsonb_array_length(changes)-1)->>'ref'); end if;

 -- A pair is stored once and is the same merge from either side; the app keys it on
 -- the sorted pair, so it is rebuilt in that same order.
 result:=jsonb_build_object(
  'version',1,'owner',p_owner,'history','[]'::jsonb,
  'links',coalesce((select jsonb_agg(format('[%s,%s]',to_jsonb(left_id),to_jsonb(right_id)) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and (left_id=any(refs) or right_id=any(refs)) and relation='link'),'[]'::jsonb),
  'cuts',coalesce((select jsonb_agg(format('[%s,%s]',to_jsonb(left_id),to_jsonb(right_id)) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and (left_id=any(refs) or right_id=any(refs)) and relation='cut'),'[]'::jsonb),
  'sourceLinks',coalesce((select jsonb_agg(jsonb_build_array(left_id,right_id) order by left_id,right_id)
   from public.journey_pair_metadata where owner_id=p_owner and (left_id=any(refs) or right_id=any(refs)) and relation='source'),'[]'::jsonb),
  'titles',coalesce((select jsonb_object_agg(ref,title) from public.journey_activity_metadata
   where owner_id=p_owner and ref=any(refs) and title is not null),'{}'::jsonb),
  'types',coalesce((select jsonb_object_agg(ref,type) from public.journey_activity_metadata
   where owner_id=p_owner and ref=any(refs) and type is not null),'{}'::jsonb),
  'manualTags',coalesce((select jsonb_object_agg(ref,to_jsonb(manual_tags)) from public.journey_activity_metadata
   where owner_id=p_owner and ref=any(refs) and cardinality(manual_tags)>0),'{}'::jsonb),
  'hiddenTags',coalesce((select jsonb_object_agg(ref,to_jsonb(hidden_tags)) from public.journey_activity_metadata
   where owner_id=p_owner and ref=any(refs) and cardinality(hidden_tags)>0),'{}'::jsonb),
  'enriched',coalesce((select jsonb_object_agg(ref,to_jsonb(enriched_at)) from public.journey_activity_metadata
   where owner_id=p_owner and ref=any(refs) and enriched_at is not null),'{}'::jsonb),
  'places',coalesce((select jsonb_object_agg(ref,lookup) from public.journey_place_metadata where owner_id=p_owner and ref=any(detail_places||p_place_refs)),'{}'::jsonb),
  'roads',coalesce((select jsonb_object_agg(ref,record) from public.journey_road_metadata where owner_id=p_owner and exists(select 1 from unnest(p_detail_refs) id where left(ref,length(id)+1)=id||':')),'{}'::jsonb),
  'distanceSummaries',coalesce((select jsonb_object_agg(ref,case when ref=any(p_detail_refs) then snapshot else snapshot-'summary'||jsonb_build_object('listOnly',true,'summary',case when jsonb_typeof(snapshot->'summary')='object' then (snapshot->'summary')-'gaps'||jsonb_build_object('gaps','[]'::jsonb) else 'null'::jsonb end) end) from public.journey_distance_summary where owner_id=p_owner and ref=any(refs)),'{}'::jsonb),
  -- An edit states what it changed; a flag that is off is absent, not false, so the
  -- value the app sees is the same whether it came from here or from a local edit.
  'stopEdits',coalesce((select jsonb_object_agg(ref,jsonb_strip_nulls(jsonb_build_object(
    'name',name,
    'tags',case when cardinality(tags)>0 then to_jsonb(tags) end,
    'replaceTags',case when replace_tags then 'true'::jsonb end,
    'ignored',case when ignored then 'true'::jsonb end)))
   from public.journey_stop_metadata s where owner_id=p_owner and exists(select 1 from unnest(refs) id where left(s.ref,length(id)+7)='native:'||id||':' or left(s.ref,length(id)+6)='dwell:'||id||':' or s.ref in (select format('[%s,%s]',to_jsonb(left_id),to_jsonb(right_id)) from public.journey_pair_metadata where owner_id=p_owner and (left_id=id or right_id=id)))),'{}'::jsonb),
  'enrichFrom',to_jsonb(state.enrich_from),
  'savedPlaces',case when cardinality(p_refs)=0 and not p_list and p_since_revision is null then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'latitude',latitude,'longitude',longitude,'radius',radius)),'[]'::jsonb) from public.saved_places where owner_id=p_owner) end,
  'activityRows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'owner_id',a.owner_id,'title',a.title,'activity',a.activity,'recording_mode',a.recording_mode,
    'started_at',a.started_at,'ended_at',a.ended_at,'duration_seconds',a.duration_seconds,'distance_meters',a.distance_meters,
    'vehicle',a.vehicle,'vehicle_id',a.vehicle_id,'provider_vehicle_id',(select v.tesla_vehicle_id from public.vehicles v where v.owner_id=p_owner and v.id=a.vehicle_id),'equipment',a.equipment,'tags',a.tags,'collection',a.collection,'visibility',a.visibility,
    'photos',case when p_geometry and a.id::text=any(p_detail_refs) then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'caption',m.caption,'latitude',m.latitude,'longitude',m.longitude,'locationSource',m.location_source)),'[]'::jsonb) from public.media_assets m where m.owner_id=p_owner and m.activity_id=a.id) end,
    'user_corrected',a.user_corrected,'revision',a.revision,'updated_at',a.updated_at,'route_points',case when p_geometry and a.id::text=any(p_detail_refs) then a.route_points end,
    'notes',case when p_geometry and a.id::text=any(p_detail_refs) then a.notes end,'description',case when p_geometry and a.id::text=any(p_detail_refs) then a.description end,
    'classification',case when p_geometry and a.id::text=any(p_detail_refs) then a.classification else jsonb_build_object('journeyStops',jsonb_build_object('version',1,'destinationStop',a.classification->'journeyStops'->'destinationStop')) end,
    'view_metadata',case when p_geometry and a.id::text=any(p_detail_refs) then a.view_metadata else jsonb_build_object('startPlace',a.view_metadata->'startPlace','endPlace',a.view_metadata->'endPlace','visibleRouteStart',a.view_metadata->'visibleRouteStart','visibleRouteEnd',a.view_metadata->'visibleRouteEnd') end,
    'point_count',jsonb_array_length(a.route_points),'firstPoint',a.route_points->0,'lastPoint',a.route_points->-1))
    from public.activities a where a.owner_id=p_owner and a.id::text=any(refs)),'[]'::jsonb),
  'recordsExist',exists(select 1 from public.journey_activity_metadata where owner_id=p_owner) or exists(select 1 from public.journey_pair_metadata where owner_id=p_owner) or exists(select 1 from public.journey_stop_metadata where owner_id=p_owner) or exists(select 1 from public.journey_place_metadata where owner_id=p_owner) or exists(select 1 from public.journey_road_metadata where owner_id=p_owner) or exists(select 1 from public.journey_distance_summary where owner_id=p_owner),
  'pageRefs',to_jsonb(page_refs),'nextActivity',next_activity,
  'unavailableRefs',to_jsonb(array(select missing.ref from unnest(refs) missing(ref) where left(missing.ref,7)<>'linked:' and not exists(select 1 from public.activities a where a.owner_id=p_owner and a.id::text=missing.ref))),
  'scope',to_jsonb(refs),'details',to_jsonb(p_detail_refs),'invalidations',changes,'next',to_jsonb(next_cursor),'atRevision',to_jsonb(head),'complete',true,
  'revision',to_jsonb(state.revision),
  'updatedAt',to_jsonb(state.updated_at)
 );
 return result;
end $$;

revoke all on function public.journey_metadata_snapshot(uuid,text[],text[],integer,text,integer,integer,text[],boolean,timestamptz,timestamptz,timestamptz,uuid,text,text,text,numeric,boolean,text,text[],text[],boolean) from public,anon,authenticated;
grant execute on function public.journey_metadata_snapshot(uuid,text[],text[],integer,text,integer,integer,text[],boolean,timestamptz,timestamptz,timestamptz,uuid,text,text,text,numeric,boolean,text,text[],text[],boolean) to authenticated;
commit;
