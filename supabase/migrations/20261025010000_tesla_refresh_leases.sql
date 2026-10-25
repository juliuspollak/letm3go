-- Proposed only. Independent of private backup; requires deployment approval.
begin;
create table public.tesla_token_leases (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 lease_id uuid not null, expires_at timestamptz not null
);
alter table public.tesla_token_leases enable row level security;
revoke all on public.tesla_token_leases from public,anon,authenticated;
grant all on public.tesla_token_leases to service_role;
create function public.acquire_tesla_token_lease(p_owner uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare lease uuid:=gen_random_uuid(); result uuid;
begin
 if not exists(select 1 from auth.users where id=p_owner) or exists(select 1 from public.account_deletion_requests where owner_id=p_owner) then return null; end if;
 insert into public.tesla_token_leases(owner_id,lease_id,expires_at) values(p_owner,lease,now()+interval '2 minutes')
 on conflict(owner_id) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at where tesla_token_leases.expires_at<now()
 returning lease_id into result;
 return result;
end $$;
create function public.save_tesla_credentials(p_owner uuid,p_lease uuid,p_ciphertext text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tesla_token_leases where owner_id=p_owner and lease_id=p_lease and expires_at>now() for update;
 if not found then raise exception 'Tesla credential lease expired'; end if;
 insert into public.provider_credentials(owner_id,provider,ciphertext,updated_at) values(p_owner,'tesla',p_ciphertext,now())
 on conflict(owner_id,provider) do update set ciphertext=excluded.ciphertext,updated_at=now();
end $$;
create function public.release_tesla_token_lease(p_owner uuid,p_lease uuid) returns void language sql security definer set search_path='' as $$
 delete from public.tesla_token_leases where owner_id=p_owner and lease_id=p_lease
$$;
revoke all on function public.acquire_tesla_token_lease(uuid),public.save_tesla_credentials(uuid,uuid,text),public.release_tesla_token_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_tesla_token_lease(uuid),public.save_tesla_credentials(uuid,uuid,text),public.release_tesla_token_lease(uuid,uuid) to service_role;
commit;
