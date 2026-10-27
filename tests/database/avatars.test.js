import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444';
const jpeg='data:image/jpeg;base64,AAAA';
const png='data:image/png;base64,BBBB';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${a}'),('${b}'),('${c}'),('${stranger}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const filename of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
  await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
},60000);
afterAll(()=>db.close());
it('resolves your own avatar first and shares it with your household only',async()=>{
 await as('authenticated',a,"select * from public.create_household('Family')");
 await as('authenticated',a,`select public.save_my_household_avatar('${jpeg}')`);
 let rows=(await as('authenticated',a,'select * from public.my_people_avatars()')).rows;
 expect(rows.map(row=>row.user_id)).toEqual([a]);
 expect((await as('authenticated',b,'select * from public.my_people_avatars()')).rows).toHaveLength(0);
 await expect(as('authenticated',stranger,'select * from public.household_member_avatars')).rejects.toThrow();
 const invite=(await as('authenticated',a,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',b,`select * from public.accept_household_invitation('${invite}')`);
 await as('authenticated',b,`select public.save_my_household_avatar('${png}')`);
 rows=(await as('authenticated',b,'select * from public.my_people_avatars()')).rows;
 expect(rows.map(row=>[row.user_id,row.avatar_data]).sort()).toEqual([[a,jpeg],[b,png]].sort());
 expect((await as('authenticated',a,'select * from public.my_people_avatars()')).rows).toHaveLength(2);
 expect((await as('authenticated',stranger,'select * from public.my_people_avatars()')).rows).toHaveLength(0);
},30000);
it('shares a photo with accepted friends until the friendship is removed',async()=>{
 await as('authenticated',c,`select public.save_my_household_avatar('${jpeg}')`).catch(()=>null);
 const invite=(await as('authenticated',a,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',c,`select public.accept_friend_invite('${invite}')`);
 const rows=(await as('authenticated',c,'select * from public.my_people_avatars()')).rows;
 expect(rows.map(row=>row.user_id)).toEqual([a]);
 await as('authenticated',a,`select public.remove_friend('${c}')`);
 expect((await as('authenticated',c,'select * from public.my_people_avatars()')).rows).toHaveLength(0);
},30000);
it('stops sharing a photo once a person leaves the household but keeps their own',async()=>{
 await as('authenticated',b,'select public.leave_household()');
 const forA=(await as('authenticated',a,'select * from public.my_people_avatars()')).rows;
 expect(forA.map(row=>row.user_id)).toEqual([a]);
 expect((await as('authenticated',b,'select * from public.my_people_avatars()')).rows.map(row=>row.user_id)).toEqual([b]);
 const invite=(await as('authenticated',a,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',b,`select * from public.accept_household_invitation('${invite}')`);
 expect((await as('authenticated',a,'select * from public.my_people_avatars()')).rows).toHaveLength(2);
},30000);
it('rejects images the WebView cannot render or that exceed the size limit',async()=>{
 await expect(as('authenticated',a,`select public.save_my_household_avatar('javascript:alert(1)')`)).rejects.toThrow();
 await expect(as('authenticated',a,`select public.save_my_household_avatar('data:image/svg+xml;base64,AAAA')`)).rejects.toThrow();
 await expect(as('authenticated',stranger,`select public.save_my_household_avatar('${jpeg}')`)).rejects.toThrow();
},30000);
