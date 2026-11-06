# Feedback administration

Migration `20261116000000_feedback_admin_and_reports.sql` (applied to production on
7 November 2026) adds ticket numbers, app admins, reports attached to tickets, and
removal of a ticket's files when it is closed.

## Make someone an admin

Admins are rows in `public.app_admins`. Only SQL can change it (Supabase dashboard →
SQL editor, or `npm run supabase -- db query --linked "…"`); the app cannot.

Find the account first. Sign in with Apple may store a private relay address, so
the display name helps:

```sql
select u.id, u.email, p.display_name, u.created_at
from auth.users u left join public.profiles p on p.id = u.id
order by u.created_at;
```

Then add it, by email or by ID:

```sql
insert into public.app_admins(user_id)
select id from auth.users where email = 'person@example.com'
on conflict do nothing;

-- or: insert into public.app_admins(user_id) values ('<user id>') on conflict do nothing;
```

Remove an admin:

```sql
delete from public.app_admins where user_id = '<user id>';
```

List admins:

```sql
select a.user_id, u.email, p.display_name
from public.app_admins a join auth.users u on u.id = a.user_id
left join public.profiles p on p.id = a.user_id;
```

The change applies the next time the person opens Feedback & Support.

## What an admin can do

In Feedback & Support → **All feedback** (visible only to admins):

- Read every account's tickets with the sender's name, photos and attached reports.
- Reply as letm3go support. A reply moves an open ticket to In review.
- Mark open, in review or resolved.
- **Close.** Closing deletes the ticket's photos and reports (recording, journey and
  tracking reports and diagnostic logs). The ticket text and conversation stay, and
  the ticket says the files were deleted. Reopening does not bring files back.
- Hide a ticket from its sender, and unhide it.

## Reports

Every report screen sends its report as feedback; there is no copy or share path.
The sender sees "Sent as feedback #N". Reports are stored with the ticket in the
private `feedback-attachments` bucket (`<owner>/<ticket>/<id>.txt` or `.json.gz`),
at most three per ticket, readable by the sender and admins. Account deletion
already removes everything in the account's folder.

## Files left behind

Closing removes the database rows first; the admin's app then deletes the files
(Storage objects cannot be deleted with SQL). If that step is interrupted, the
app says how many files were left. This read-only query finds them, and any upload
that was never registered:

```sql
select o.name, o.created_at
from storage.objects o
left join public.feedback_attachments a on a.object_key = o.name
left join public.feedback_reports r on r.object_key = o.name
where o.bucket_id = 'feedback-attachments' and a.id is null and r.id is null
  and o.created_at < now() - interval '1 day'
order by o.created_at;
```

Delete what it lists through the dashboard (Storage → feedback-attachments) or the
Storage API.

## Repeating older migrations by hand

`20261110000000` and `20261111000000` restore a photo-only upload check. If either is
ever run again by hand, run `20261116000000` after them.
