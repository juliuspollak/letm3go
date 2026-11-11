-- Invalidate existing live geometry when the existing Home/Work mask changes.
-- No route data is copied and no additional channel is introduced.
begin;
alter table public.live_trails add column if not exists privacy_revision bigint not null default 0;
-- Replace the signature atomically. Two-argument callers still resolve through
-- defaults, but upgraded callers send the revision to retain incremental polls.
drop function public.my_live_trail(uuid,double precision);
create or replace function public.my_live_trail(p_owner uuid,p_after double precision default 0,p_revision text default null)
returns table(activity_ref text,started_at timestamptz,updated_at timestamptz,points jsonb,roads jsonb,point_count integer,newest_t double precision,privacy_revision text)
language plpgsql stable security definer set search_path='' as $$
declare v_household boolean; v_friend boolean; v_self boolean; v_t public.live_trails; v_open boolean; v_revision text;
begin
 if auth.uid() is null or p_owner is null then return; end if;
 v_self:=auth.uid()=p_owner;
 v_household:=exists(select 1 from public.household_memberships me join public.household_memberships o on o.household_id=me.household_id
   where me.user_id=auth.uid() and o.user_id=p_owner and me.user_id<>o.user_id)
  and exists(select 1 from public.household_live_locations l where l.user_id=p_owner and l.enabled);
 v_friend:=exists(select 1 from public.my_friends() f where f.user_id=p_owner)
  and exists(select 1 from public.friend_presence_shares s where s.user_id=p_owner and s.enabled);
 if not (v_self or v_household or v_friend) then return; end if;
 v_open:=v_self or v_household;
 select * into v_t from public.live_trails t where t.owner_id=p_owner and t.updated_at>now()-interval '10 minutes';
 if not found then return; end if;
 -- Include audience scope: leaving a household but staying a friend also changes
 -- which points are authorised, even when Home/Work did not move.
 v_revision:=v_t.privacy_revision::text||case when v_open then ':open' else ':masked' end;
 if p_revision is distinct from v_revision then p_after:=0; end if;
 -- The common poll finds nothing new: answer without evaluating the mask for every point.
 if jsonb_array_length(v_t.points)>0 and coalesce(p_after,0)>=(v_t.points->-1->>2)::float8 then
  return query select v_t.activity_ref,v_t.started_at,v_t.updated_at,'[]'::jsonb,
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val) where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),case when v_open then (v_t.points->-1->>2)::float8 end,v_revision;
  return;
 end if;
 return query
  with pts as (
   select x,(x->>2)::float8 as t,(x->>3)::numeric as seg,
    (not v_open) and exists(select 1 from public.saved_places sp
     where sp.owner_id=p_owner and sp.kind in ('home','work')
      and sqrt(power(((x->>0)::float8-sp.latitude)*111320,2)+power(((x->>1)::float8-sp.longitude)*111320*cos(radians(sp.latitude)),2))<=sp.radius+300) as hidden
   from jsonb_array_elements(v_t.points) x),
  -- A visible point whose stretch from the previous fix passes the masked distance also
  -- starts a new run, even though no point lies inside it (sparse fixes at speed).
  linked as (select pts.*,lag(x) over (order by t) as px,lag(hidden) over (order by t) as ph from pts),
  marked as (select l.*,(not l.hidden) and l.px is not null and not coalesce(l.ph,false) and (not v_open)
     and public.segment_near_private_place(p_owner,(l.px->>0)::float8,(l.px->>1)::float8,(l.x->>0)::float8,(l.x->>1)::float8) as crossing from linked l),
  counted as (select m.*,count(*) filter (where m.hidden or m.crossing) over (order by m.t rows between unbounded preceding and current row) as hid from marked m)
  select v_t.activity_ref,v_t.started_at,v_t.updated_at,
   coalesce((select jsonb_agg(jsonb_build_array(c.x->0,c.x->1,c.x->2,c.seg*100000+c.hid) order by c.t) from counted c
    where not c.hidden and c.t>coalesce(p_after,0)),'[]'::jsonb),
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val)
    where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),
   case when v_open then (select max(t) from pts) end,v_revision;
end $$;
revoke all on function public.my_live_trail(uuid,double precision,text) from public,anon,authenticated;
grant execute on function public.my_live_trail(uuid,double precision,text) to authenticated;


create or replace function public.road_privacy_places_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=coalesce(new.owner_id,old.owner_id);
begin
 if coalesce(new.kind,'') not in ('home','work') and coalesce(old.kind,'') not in ('home','work') then return null; end if;
 if tg_op='UPDATE' and new.kind=old.kind and new.latitude=old.latitude and new.longitude=old.longitude and new.radius=old.radius then return null; end if;
 -- The revision and road flags commit with the place change. A stale cursor
 -- receives a full newly masked trail, even if no new fix has arrived.
 update public.live_trails set privacy_revision=privacy_revision+1 where owner_id=v_owner;
 perform public.signal_user_shares(v_owner);
 perform public.signal_user_shares(case when f.user_low=v_owner then f.user_high else f.user_low end)
  from public.friend_connections f where f.user_low=v_owner or f.user_high=v_owner;
 perform public.signal_user_shares(m.user_id) from public.household_memberships m
  where m.household_id in (select o.household_id from public.household_memberships o where o.user_id=v_owner)
   and m.user_id<>v_owner;
 -- Every flag becomes unknown (a cheap update that is not journalled). They are decided again when an
 -- activity is shared (road_privacy_on_share); until then a read decodes the road itself.
 update public.road_privacy set clear=null where owner_id=v_owner and clear is not null;
 -- Roads on a live trail in progress are checked against the new places straight away.
 update public.live_trails t set roads=(select coalesce(jsonb_object_agg(e.key,jsonb_build_object('l',e.value->>'l','c',public.road_clear_of_private_places(v_owner,e.value->>'l'))),'{}'::jsonb) from jsonb_each(t.roads) e) where t.owner_id=v_owner and t.roads<>'{}'::jsonb;
 return null;
end $$;
revoke all on function public.road_privacy_places_changed() from public,anon,authenticated;
drop trigger if exists road_privacy_places_changed on public.saved_places;
create trigger road_privacy_places_changed after insert or update or delete on public.saved_places
for each row execute function public.road_privacy_places_changed();


commit;
