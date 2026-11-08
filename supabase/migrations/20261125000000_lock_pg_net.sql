-- pg_net's default grants let anon and authenticated read its request queue,
-- where a dispatch's Authorization header (the push worker secret) waits until it
-- is sent, and call net.http_post. The net schema is not exposed by the API, so
-- apps could not reach it, but only the database itself dispatches (20261124000000,
-- as the function owner), so app roles need none of it.
begin;
do $$ begin
 if exists(select 1 from pg_namespace where nspname='net') then
  revoke all on all tables in schema net from public,anon,authenticated;
  revoke all on all sequences in schema net from public,anon,authenticated;
  revoke execute on all functions in schema net from public,anon,authenticated;
  revoke usage on schema net from public,anon,authenticated;
 end if;
end $$;
commit;
