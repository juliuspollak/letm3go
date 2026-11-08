-- Idempotent proposals from a private MTB recording. The public definition stores
-- only the explicitly selected route, never activity IDs, timestamps or metrics.
begin;
create or replace function public.create_mtb_segment(
 p_client_id uuid,p_name text,p_geometry jsonb,p_description text default '',p_trail_id uuid default null,
 p_direction text default 'both',p_difficulty text default null,p_access text default 'unknown',p_distance_meters double precision default 0
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.mtb_segments; geometry jsonb;
begin
 if auth.uid() is null or not public.account_is_active() then raise exception 'Sign in to create a segment.';end if;
 if p_client_id is null or length(trim(p_name)) not between 1 and 150 or not public.valid_mtb_geometry(p_geometry) then raise exception 'Invalid segment proposal';end if;
 -- Serialise identical client IDs even before the first row exists.
 perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,0));
 select * into existing from public.mtb_segments where id=p_client_id for update;
 if found then
  if existing.creator_id<>auth.uid() then raise exception 'Segment ID belongs to another creator';end if;
  select g.geometry into geometry from public.mtb_segment_geometry g where g.segment_id=p_client_id and g.version=existing.version;
  if geometry=p_geometry and existing.name=trim(p_name) then return p_client_id;end if;
  raise exception 'This public segment already exists. Edit it through community moderation; the private activity was preserved.';
 end if;
 if p_trail_id is not null and not exists(select 1 from public.mtb_trails where id=p_trail_id) then raise exception 'Unknown trail';end if;
 insert into public.mtb_segments(id,name,description,trail_id,direction,difficulty,access,status,visibility,creator_id,version)
  values(p_client_id,trim(p_name),coalesce(p_description,''),p_trail_id,p_direction,p_difficulty,p_access,'draft','private',auth.uid(),1);
 insert into public.mtb_segment_geometry(segment_id,version,geometry,distance_meters,confidence)
  values(p_client_id,1,p_geometry,p_distance_meters,'gps');
 perform public.submit_mtb('segment',p_client_id);
 return p_client_id;
end $$;
revoke all on function public.create_mtb_segment(uuid,text,jsonb,text,uuid,text,text,text,double precision) from public,anon,authenticated;
grant execute on function public.create_mtb_segment(uuid,text,jsonb,text,uuid,text,text,text,double precision) to authenticated;
commit;
