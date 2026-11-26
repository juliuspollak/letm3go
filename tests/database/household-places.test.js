import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it} from 'vitest';

const db=new PGlite();
const [owner,member,friend,stranger,home,otherHome,work,school]=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);

beforeAll(async()=>{
 await db.exec(`
  create role authenticated;
  create role anon;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
   $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated;
  create table auth.users(id uuid primary key);
  create table public.households(id uuid primary key);
  create table public.household_memberships(
   user_id uuid primary key references auth.users(id),
   household_id uuid not null references public.households(id) on delete cascade
  );
  create function public.repair_household() returns trigger
  language plpgsql as $$
  begin
   if not exists(select 1 from public.household_memberships where household_id=old.household_id)
    then delete from public.households where id=old.household_id;
   end if;
   return old;
  end $$;
  create trigger repair_household after delete on public.household_memberships
   for each row execute function public.repair_household();
  create table public.friend_connections(user_low uuid,user_high uuid);
  create function public.my_household() returns table(id uuid)
   language sql stable security definer set search_path='' as
   $$ select household_id from public.household_memberships where user_id=auth.uid() $$;
  create function public.my_friends() returns table(user_id uuid)
   language sql stable security definer set search_path='' as
   $$ select case when user_low=auth.uid() then user_high else user_low end
      from public.friend_connections where auth.uid() in (user_low,user_high) $$;
  insert into auth.users values ('${owner}'),('${member}'),('${friend}'),('${stranger}');
  insert into public.households values ('${home}'),('${otherHome}');
  insert into public.household_memberships values ('${owner}','${home}'),('${member}','${home}'),('${stranger}','${otherHome}');
  insert into public.friend_connections values ('${owner}','${friend}');
 `);
 await db.exec(await readFile('supabase/migrations/20261219000000_household_places.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261219010000_social_locations.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261219020000_detach_locations_on_household_departure.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261219030000_smaller_social_location_radius.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261219040000_home_location_icon.sql','utf8'));
});
afterAll(()=>db.close());

it('allows same-household reads, opt-in friend reads and creator-only edits',async()=>{
 const act=async user=>{
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 };
 const read=async()=>(await db.query('select name from public.household_places order by name')).rows.map(row=>row.name);
 const create=(id,household,name,icon,shared,radius=85)=>db.query(
  'insert into public.household_places(id,household_id,name,icon,latitude,longitude,radius,share_with_friends) values($1,$2,$3,$4,-33,151,$6,$5) returning id',
  [id,household,name,icon,shared,radius]);
 await act(owner);
 await create(work,home,'Work','work',true);
 await expect(create(school,otherHome,'School','school',false)).rejects.toThrow(/row-level security/);
 await expect(create(school,home,'School','none',false,14)).rejects.toThrow(/household_places_radius_check/);
 await create(school,home,'School','home',false,15);
 await act(member);
 expect(await read()).toEqual(['School','Work']);
 expect((await db.query("update public.household_places set name='Changed' returning id")).rows).toEqual([]);
 expect((await db.query('delete from public.household_places returning id')).rows).toEqual([]);
 await act(friend);
 expect(await read()).toEqual(['Work']);
 const personal='00000000-0000-4000-8000-000000000009';
 await create(personal,null,'Library','none',false);
 expect(await read()).toEqual(['Library','Work']);
 await act(owner);
 expect(await read()).toEqual(['School','Work']);
 await act(friend);
 await db.query('update public.household_places set share_with_friends=true where id=$1',[personal]);
 await act(owner);
 expect(await read()).toEqual(['Library','School','Work']);
 await act(stranger);
 expect(await read()).toEqual([]);
 await act(owner);
 await db.query('update public.household_places set share_with_friends=false where id=$1',[work]);
 await act(friend);
 expect(await read()).toEqual(['Library']);
 await db.exec('reset role; set role anon');
 await expect(read()).rejects.toThrow(/permission denied/);
});

it('keeps locations and friend sharing when a creator leaves or a household is removed',async()=>{
 const shared='00000000-0000-4000-8000-000000000010';
 const privatePlace='00000000-0000-4000-8000-000000000011';
 await db.exec('reset role');
 await db.query(
  `insert into public.household_places(id,household_id,owner_id,name,icon,latitude,longitude,radius,share_with_friends)
   values($1,$3,$4,'Work','work',-33,151,85,true),($2,$3,$5,'School','school',-33,151,85,false)`,
  [shared,privatePlace,home,owner,member]);
 const visible=async(user,id)=>{
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  const result=await db.query('select household_id,owner_id,share_with_friends from public.household_places where id=$1',[id]);
  await db.exec('reset role');
  return result.rows;
 };
 expect(await visible(member,shared)).toHaveLength(1);
 await db.query('delete from public.household_memberships where user_id=$1',[owner]);
 expect(await visible(member,shared)).toEqual([]);
 const detachedShared=[{household_id:null,owner_id:owner,share_with_friends:true}];
 expect(await visible(owner,shared)).toEqual(detachedShared);
 expect(await visible(friend,shared)).toEqual(detachedShared);
 await db.query('delete from public.household_memberships where user_id=$1',[member]);
 expect((await db.query('select id from public.households where id=$1',[home])).rows).toEqual([]);
 expect(await visible(member,privatePlace)).toEqual([{household_id:null,owner_id:member,share_with_friends:false}]);
 expect(await visible(friend,shared)).toEqual(detachedShared);
});
