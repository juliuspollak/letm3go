# Post-merge integration audit

Base: `origin/main` at `b4351c5`. Findings are reported in full with the branch; this file keeps what operators need later.

## Migration history on the linked database

Checked read-only on 2026-10-31. `20261108000000` and `20261109000000` exist on the database, applied by hand, but are not recorded in `supabase_migrations.schema_migrations`.

`db push` would therefore replay them, and `20261109000000` would stop at `create table public.feedback`. The transaction rolls back, so nothing is damaged, but no later migration would apply.

Remediation, for a person to run after checking the output of each step:

```bash
npm run supabase -- migration list --linked
npm run supabase -- migration repair --linked --status applied 20261108000000 20261109000000
npm run supabase -- migration list --linked
npm run supabase -- db push --linked --dry-run
npm run supabase -- db push --linked
```

The dry run must list only `20261110000000_feedback_storage_hardening.sql`.

## Deployment order

1. Apply `20261110000000`. Current app builds keep working: their keys already match the new rules.
2. Deploy the `account` edge function, so account deletion removes feedback photos.
3. Ship the app.

## Finding stranded photos

A photo can be stranded only if the app stops between its upload and its registration, and the ticket is never retried. Run this read-only query, then remove what it finds through the Storage API or dashboard. Storage does not allow deleting objects with SQL.

```sql
select o.name, o.created_at
from storage.objects o
left join public.feedback_attachments a on a.object_key = o.name
where o.bucket_id = 'feedback-attachments' and a.id is null and o.created_at < now() - interval '1 day'
order by o.created_at;
```

Photos of accounts deleted before the `account` function is redeployed will also appear here.
