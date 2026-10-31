#!/usr/bin/env bash
# Runs in CI against the real Supabase stack, on a throwaway database: real concurrent
# sessions, which PGlite's single connection cannot give. Eight writers each hold their
# transaction open for a second, so without the lock all eight would pass the count.
set -u
db=$1
owner=33333333-3333-4333-8333-333333333333
ticket=99999999-9999-4999-8999-999999999999
sql(){ docker exec -i "$db" psql -v ON_ERROR_STOP=1 -qAt -U postgres -d postgres "$@"; }
sql -c "insert into auth.users(id,email) values('$owner','concurrency@example.test');
 insert into public.feedback(id,client_token,owner_id,category,description) values('$ticket',gen_random_uuid(),'$owner','bug','x');"
writer(){
 sql >/dev/null 2>&1 <<SQL
begin;
select set_config('request.jwt.claims',json_build_object('sub','$owner','role','authenticated')::text,true),set_config('request.jwt.claim.sub','$owner',true);
set local role authenticated;
$1
select pg_sleep(1);
commit;
SQL
}
photo(){ printf 'dddddddd-dddd-4ddd-8ddd-%012d' "$1"; }
check(){
 found=$(sql -c "$2")
 if [ "$found" != 5 ]; then echo "$1: expected 5, found $found"; exit 1; fi
}
for n in 1 2 3 4 5 6 7 8; do
 id=$(photo "$n")
 writer "insert into public.feedback_attachments(id,feedback_id,owner_id,object_key,byte_size,width,height) values('$id','$ticket','$owner','$owner/$ticket/$id.jpg',10,10,10);" &
done
wait
check 'registered photos' "select count(*) from public.feedback_attachments where feedback_id='$ticket'"
for n in 1 2 3 4 5 6 7 8; do
 writer "insert into storage.objects(bucket_id,name) values('feedback-attachments','$owner/$ticket/$(photo "$n").jpg');" &
done
wait
check 'stored objects' "select count(*) from storage.objects where bucket_id='feedback-attachments' and name like '$owner/$ticket/%'"
echo 'feedback-concurrency checks passed'
