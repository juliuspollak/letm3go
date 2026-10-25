-- PROPOSED ONLY: review and approve before remote deployment. No vehicle is enabled here.
begin;
alter table public.vehicles add constraint vehicles_id_owner_unique unique(id,owner_id);
alter table public.activities add column vehicle_id uuid;
alter table public.activities add constraint activity_vehicle_owner_fk foreign key(vehicle_id,owner_id) references public.vehicles(id,owner_id);
-- Browser clients cannot fabricate telemetry-backed records or overwrite source data.
create function public.protect_fleet_source() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and (new.recording_mode='tesla' or (TG_OP='UPDATE' and old.recording_mode='tesla')) then
  if TG_OP='INSERT' or (to_jsonb(new)-array['title','activity','description','notes','tags','collection','classification','user_corrected','visibility','revision','updated_at']) is distinct from (to_jsonb(old)-array['title','activity','description','notes','tags','collection','classification','user_corrected','visibility','revision','updated_at']) then raise exception 'Telemetry source is server-managed';end if;
 end if;
 return new;
end $$;
create trigger protect_fleet_source before insert or update on public.activities for each row execute function public.protect_fleet_source();
revoke all on function public.protect_fleet_source() from public,anon,authenticated;
create table public.fleet_bindings (
 vin text primary key check(vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
 vehicle_id uuid not null unique,owner_id uuid not null references auth.users(id) on delete cascade,
 foreign key(vehicle_id,owner_id) references public.vehicles(id,owner_id) on delete cascade,
 enabled boolean not null default false,enabled_since timestamptz,
 projected_revision bigint not null default 0,
 unique(vin,owner_id),
 config_synced boolean not null default false,key_paired boolean,key_required boolean,location_verified boolean not null default false,
 household_id uuid references public.households(id) on delete set null,share_from timestamptz,
 stream_connected boolean,connectivity_at timestamptz,last_received timestamptz,error text,revision bigint not null default 0,
 check(not enabled or (enabled_since is not null and config_synced)),
 check((household_id is null)=(share_from is null))
);
create table public.fleet_receiver_health (
 id text primary key check(id='primary'),ready boolean not null,last_seen timestamptz not null,
 version text not null check(length(version)<=100)
);
create table public.fleet_events (
 vin text not null references public.fleet_bindings(vin) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 event_at timestamptz not null,received_at timestamptz not null default now(),
 fields jsonb not null check(jsonb_typeof(fields)='object' and octet_length(fields::text)<=10000),
 primary key(vin,fingerprint),foreign key(vin,owner_id) references public.fleet_bindings(vin,owner_id) on delete cascade
);
create index fleet_events_replay on public.fleet_events(vin,event_at,fingerprint);
create index fleet_events_owner on public.fleet_events(owner_id);
create table public.fleet_segments (
 id uuid primary key,activity_id uuid references public.activities(id) on delete set null,
 owner_id uuid not null references auth.users(id) on delete cascade,
 vehicle_id uuid not null,foreign key(vehicle_id,owner_id) references public.vehicles(id,owner_id) on delete cascade,
 started_at timestamptz not null,ended_at timestamptz not null,
 incomplete boolean not null default false,household_id uuid references public.households(id) on delete set null,
 check(ended_at>=started_at)
);
create index fleet_segments_vehicle_time on public.fleet_segments(vehicle_id,started_at);
create index fleet_segments_owner on public.fleet_segments(owner_id);
create index fleet_segments_activity on public.fleet_segments(activity_id);
create index fleet_segments_household on public.fleet_segments(household_id);
create table public.fleet_charging_stops (
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 vehicle_id uuid not null,foreign key(vehicle_id,owner_id) references public.vehicles(id,owner_id) on delete cascade,
 started_at timestamptz not null,ended_at timestamptz not null,latitude double precision,longitude double precision,
 battery_before double precision,battery_after double precision,energy_added double precision,incomplete boolean not null default false,
 check(ended_at>=started_at),check(latitude between -90 and 90),check(longitude between -180 and 180),
 check(battery_before between 0 and 100),check(battery_after between 0 and 100),check(energy_added between 0 and 1000),
 unique(vehicle_id,started_at)
);
create index fleet_charges_owner on public.fleet_charging_stops(owner_id);
create index fleet_charges_vehicle on public.fleet_charging_stops(vehicle_id,started_at);
do $$ declare t text; begin
 foreach t in array array['fleet_bindings','fleet_receiver_health','fleet_events','fleet_segments','fleet_charging_stops'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['fleet_bindings','fleet_events','fleet_charging_stops'] loop
  execute format('create trigger guard_owner_write before insert or update on public.%I for each row execute function public.guard_owner_write(''owner_id'')',t);
 end loop;
end $$;
create function public.normalise_fleet_household() returns trigger language plpgsql set search_path='' as $$
begin if new.household_id is null then new.share_from=null;end if;return new;end $$;
create trigger a_normalise_fleet_household before insert or update on public.fleet_bindings for each row execute function public.normalise_fleet_household();
revoke all on function public.normalise_fleet_household() from public,anon,authenticated;
-- Permit only FK cleanup of a deleted source during Auth-user cascades.
create function public.guard_fleet_segment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.activity_id is null and old.activity_id is not null and to_jsonb(new)-'activity_id'=to_jsonb(old)-'activity_id' then return new;end if;
 perform 1 from auth.users where id=new.owner_id for key share;
 if not found or exists(select 1 from public.account_deletion_requests where owner_id=new.owner_id) then raise exception 'Account unavailable';end if;
 return new;
end $$;
create trigger guard_fleet_segment before insert or update on public.fleet_segments for each row execute function public.guard_fleet_segment();
revoke all on function public.guard_fleet_segment() from public,anon,authenticated;
create function public.stop_fleet_on_disconnect() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.provider='tesla' and exists(select 1 from auth.users where id=old.owner_id) and not exists(select 1 from public.account_deletion_requests where owner_id=old.owner_id) then update public.fleet_bindings set enabled=false,error='Tesla disconnected' where owner_id=old.owner_id;end if;return old;
end $$;
create trigger stop_fleet_on_disconnect before delete on public.connected_services for each row execute function public.stop_fleet_on_disconnect();
revoke all on function public.stop_fleet_on_disconnect() from public,anon,authenticated;
grant select on public.fleet_bindings,public.fleet_segments,public.fleet_charging_stops to authenticated;
create policy fleet_binding_owner on public.fleet_bindings for select to authenticated using(owner_id=(select auth.uid()) and (select public.account_is_active()));
create function public.can_read_fleet_activity(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_is_active() and exists(
  select 1 from public.fleet_segments s join public.fleet_bindings b on b.vehicle_id=s.vehicle_id
  join public.household_memberships m on m.household_id=s.household_id and m.user_id=auth.uid()
  join public.household_memberships publisher on publisher.household_id=s.household_id and publisher.user_id=s.owner_id
  where s.activity_id=p_id and s.household_id=b.household_id and b.share_from is not null and s.started_at>=b.share_from
  and not exists(select 1 from public.account_deletion_requests d where d.owner_id=s.owner_id)
 )
$$;
revoke all on function public.can_read_fleet_activity(uuid) from public,anon,authenticated;
grant execute on function public.can_read_fleet_activity(uuid) to authenticated,service_role;
create policy fleet_activity_household on public.activities for select to authenticated using(public.can_read_fleet_activity(id));
create policy fleet_segment_read on public.fleet_segments for select to authenticated using((owner_id=(select auth.uid()) and (select public.account_is_active())) or public.can_read_fleet_activity(activity_id));
create policy fleet_charge_owner on public.fleet_charging_stops for select to authenticated using(owner_id=(select auth.uid()) and (select public.account_is_active()));
create function public.can_read_fleet_charge(p_vehicle uuid,p_at timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_is_active() and exists(select 1 from public.fleet_bindings b join public.household_memberships viewer on viewer.household_id=b.household_id and viewer.user_id=auth.uid() join public.household_memberships publisher on publisher.household_id=b.household_id and publisher.user_id=b.owner_id where b.vehicle_id=p_vehicle and b.share_from is not null and p_at>=b.share_from and not exists(select 1 from public.account_deletion_requests where owner_id=b.owner_id))
$$;
revoke all on function public.can_read_fleet_charge(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.can_read_fleet_charge(uuid,timestamptz) to authenticated,service_role;
create policy fleet_charge_household on public.fleet_charging_stops for select to authenticated using(public.can_read_fleet_charge(vehicle_id,started_at));
create policy fleet_stop_household on public.activity_stops for select to authenticated using(public.can_read_fleet_activity(activity_id));

-- Lock a VIN and provide one coherent replay snapshot. No client chooses the owner.
create function public.ingest_fleet_event(p_vin text,p_fingerprint text,p_time timestamptz,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.fleet_bindings; inserted integer;
begin
 select * into b from public.fleet_bindings where vin=p_vin for update;
 if not found or not b.enabled or not b.config_synced or p_time<b.enabled_since then return jsonb_build_object('ignored',true); end if;
 perform 1 from auth.users where id=b.owner_id for key share;
 if not found or exists(select 1 from public.account_deletion_requests where owner_id=b.owner_id) or not exists(select 1 from public.connected_services where owner_id=b.owner_id and provider='tesla' and status='connected') then raise exception 'Account or connection unavailable'; end if;
 if p_time>now()+interval '5 minutes' or p_time<now()-interval '7 days' then raise exception 'Event outside retention'; end if;
 if (select count(*) from public.fleet_events where vin=p_vin)>=50000 and not exists(select 1 from public.fleet_events where vin=p_vin and fingerprint=p_fingerprint) then raise exception 'Replay budget exceeded'; end if;
 insert into public.fleet_events(vin,owner_id,fingerprint,event_at,fields) values(p_vin,b.owner_id,p_fingerprint,p_time,p_fields) on conflict do nothing;
 get diagnostics inserted=row_count;
 update public.fleet_bindings set revision=revision+inserted,last_received=case when p_fields-'connected'<>'{}'::jsonb then greatest(last_received,p_time) else last_received end,stream_connected=case when p_fields ? 'connected' and (connectivity_at is null or p_time>connectivity_at) then (p_fields->>'connected')::boolean else stream_connected end,connectivity_at=case when p_fields ? 'connected' then greatest(connectivity_at,p_time) else connectivity_at end,location_verified=location_verified or (p_fields ? 'location') where vin=p_vin returning * into b;
 return jsonb_build_object('owner',b.owner_id,'vehicle',b.vehicle_id,'enabledSince',extract(epoch from b.enabled_since),'revision',b.revision,
 'events',coalesce((select jsonb_agg(jsonb_build_object('timestamp',extract(epoch from event_at),'fields',fields) order by event_at,fingerprint) from public.fleet_events where vin=p_vin and event_at>=now()-interval '7 days'),'[]'::jsonb),
 'existing',coalesce((select jsonb_agg(jsonb_build_object('id',id,'startedAt',extract(epoch from started_at),'endedAt',extract(epoch from ended_at))) from public.fleet_segments where vehicle_id=b.vehicle_id and ended_at>=now()-interval '7 days'),'[]'::jsonb));
end $$;
create function public.commit_fleet_projection(p_vin text,p_revision bigint,p_drives jsonb,p_charges jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.fleet_bindings; d jsonb; c jsonb; sid uuid; aid uuid; start_time timestamptz; end_time timestamptz;
begin
 select * into b from public.fleet_bindings where vin=p_vin for update;
 if not found or not b.enabled or b.revision<>p_revision then return false; end if;
 if jsonb_array_length(p_drives)>1000 or jsonb_array_length(p_charges)>1000 then raise exception 'Projection too large'; end if;
 for d in select * from jsonb_array_elements(p_drives) loop
  sid:=(d->>'id')::uuid; start_time:=to_timestamp((d->>'startedAt')::double precision);end_time:=to_timestamp((d->>'endedAt')::double precision);
  -- A removed original must stay removed, including after delayed telemetry replay.
  -- A retention-window replay must never replace a complete source with its tail.
  if exists(select 1 from public.fleet_segments where id=sid and started_at<start_time) then continue;end if;
  if exists(select 1 from public.activity_tombstones where id=sid) or exists(select 1 from public.fleet_segments where id=sid and activity_id is null) then continue; end if;
  if exists(select 1 from public.activities where id=sid and (owner_id<>b.owner_id or recording_mode<>'tesla')) then raise exception 'Source collision';end if;
  insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,vehicle_id,route_points,tags,classification)
  values(sid,b.owner_id,'Driving','Driving','tesla',start_time,end_time,(d->>'durationSeconds')::double precision,(d->>'distanceMeters')::double precision,(select name from public.vehicles where id=b.vehicle_id),b.vehicle_id,d->'points',array['Tesla'],coalesce(d->'details'->'classification','{}'))
  on conflict(id) do update set started_at=excluded.started_at,ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,distance_meters=excluded.distance_meters,route_points=excluded.route_points;
  insert into public.fleet_segments(id,activity_id,owner_id,vehicle_id,started_at,ended_at,incomplete,household_id)
  values(sid,sid,b.owner_id,b.vehicle_id,start_time,end_time,coalesce((d->>'incomplete')::boolean,false),case when b.share_from is not null and start_time>=b.share_from then b.household_id else null end)
  on conflict(id) do update set started_at=excluded.started_at,ended_at=excluded.ended_at,incomplete=excluded.incomplete;
 end loop;
 for c in select * from jsonb_array_elements(p_charges) loop
  start_time:=to_timestamp((c->>'startedAt')::double precision);end_time:=to_timestamp((c->>'endedAt')::double precision);
  insert into public.fleet_charging_stops(id,owner_id,vehicle_id,started_at,ended_at,latitude,longitude,battery_before,battery_after,energy_added,incomplete)
  values((c->>'id')::uuid,b.owner_id,b.vehicle_id,start_time,end_time,(c->>'latitude')::double precision,(c->>'longitude')::double precision,(c->>'batteryBefore')::double precision,(c->>'batteryAfter')::double precision,(c->>'energyAdded')::double precision,coalesce((c->>'incomplete')::boolean,false))
  on conflict(vehicle_id,started_at) do update set ended_at=excluded.ended_at,battery_after=excluded.battery_after,energy_added=excluded.energy_added,incomplete=excluded.incomplete;
 end loop;
 update public.fleet_bindings set projected_revision=p_revision,error=null where vin=p_vin;
 return true;
end $$;
revoke all on function public.ingest_fleet_event(text,text,timestamptz,jsonb),public.commit_fleet_projection(text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_fleet_event(text,text,timestamptz,jsonb),public.commit_fleet_projection(text,bigint,jsonb,jsonb) to service_role;
create function public.purge_processed_fleet_events() returns void language sql security definer set search_path='' as $$
 delete from public.fleet_events e using public.fleet_bindings b where e.vin=b.vin and b.projected_revision=b.revision and e.event_at<now()-interval '7 days'
$$;
revoke all on function public.purge_processed_fleet_events() from public,anon,authenticated;
grant execute on function public.purge_processed_fleet_events() to service_role;
commit;
