-- my_friends() named people from account_preferences (an empty table in production) and auth metadata, so a friend
-- who never set metadata showed as "Friend" with the letter F, while the household list, which reads profiles,
-- showed their real name. Friends now use the same name as everywhere else: the profile's display name first.
begin;
create or replace function public.my_friends()
returns table(user_id uuid,display_name text)
language sql stable security definer set search_path='' as $$
 select u.id,coalesce(nullif(btrim(pr.display_name),''),nullif(btrim(p.display_name),''),nullif(btrim(u.raw_user_meta_data->>'display_name'),''),'Friend')
 from public.friend_connections c
 join auth.users u on u.id=case when c.user_low=auth.uid() then c.user_high else c.user_low end
 left join public.profiles pr on pr.id=u.id
 left join public.account_preferences p on p.user_id=u.id
 where c.user_low=auth.uid() or c.user_high=auth.uid()
 order by 2,u.id
$$;
commit;
