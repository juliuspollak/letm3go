-- Sharing new activities with the household is ON by default (20261202000000 turned it on for people who
-- JOIN a household from then on). People who were already members have no row, which reads as "off".
-- Give each of them the same default: on, from now (activities they record from here on; nothing already
-- recorded is shared). Anyone who has made a choice already has a row and is left exactly as it is.
insert into public.activity_auto_share(user_id,enabled,since)
select distinct m.user_id,true,now()
from public.household_memberships m
on conflict (user_id) do nothing;
