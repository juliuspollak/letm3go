# Notifications, push and pokes

What notifies whom (migration `20261123000000_notifications_and_pokes.sql`):

| Event | Recipient | In the app | Push |
| --- | --- | --- | --- |
| New feedback, or a sender's reply | every admin (`app_admins`) | badge on the profile bubble; "N new" on Feedback & Support | yes |
| Staff reply, resolved or closed | the person who sent the feedback | same | yes |
| Trail or segment submitted for review | every moderator (`moderators`) and admin | "Trails & segments to review" in the profile sheet; opens Map → Trails → Review | yes |
| Poke (tap a person on Home) | that friend or household member | 👋 banner | yes |

Admins are moderators too: `is_moderator()` accepts either list.

## How delivery works

1. A trigger writes a row to `notifications` in the same transaction as the
   feedback, message, status change, submission or poke.
2. The app then calls the `send-push-notifications` Edge Function ("wake").
   The function fans the new rows out to the recipient's registered devices
   (`push_devices`, bound to a live login session) and sends them via APNs.
3. There is **no scheduled job**. Every app foreground also wakes the function,
   so an undelivered push is retried then. Pushes older than a day, or already
   read in the app, are not sent.
4. Read notifications older than 60 days are removed when that person next
   receives one. Pokes older than a day are removed on the next poke.

The badge on the app icon is the unread count when the last push arrived and is
cleared when the app opens; the profile bubble shows what is still unread.
Opening Feedback & Support marks feedback notifications read; opening Trails →
Review marks review notifications read; a poke banner is read when dismissed.

Pokes: friends or same household only, one per person per minute, 60 per hour.

## One-time setup

1. Apply the migration (with the usual ledger check first):

   ```bash
   npm run supabase -- db push --linked
   ```

2. Set the APNs secrets on the letm3go Supabase project. Use an APNs
   Authentication Key (`.p8`) from the same Apple Developer team as the app.
   The key ImBored uses works, because APNs keys are per team, not per app.
   Never paste the key into chat or commit it.

   ```bash
   npm run supabase -- secrets set --project-ref subobfmlkfqcsaekygat APNS_KEY_ID=<10-character key id> APNS_TEAM_ID=<team id> APNS_PRIVATE_KEY="$(cat /path/to/AuthKey_<KEYID>.p8)"
   ```

3. Deploy the function:

   ```bash
   npm run supabase -- functions deploy send-push-notifications --project-ref subobfmlkfqcsaekygat
   ```

4. On the iPhone, allow notifications when the app asks, which happens once
   after sign-in. You can also turn them on later in Account & settings.

Make someone a moderator only (admins already are):

```sql
insert into public.moderators(user_id) select id from auth.users where email='<email>';
```

## Checking delivery

```sql
-- Recent notifications and whether they were pushed
select n.created_at,n.kind,n.title,n.read_at,d.status,d.last_status,d.last_reason
from public.notifications n left join public.notification_deliveries d on d.notification_id=n.id
order by n.id desc limit 20;
```

A `last_reason` of `ApnsNotConfigured` means the secrets from step 2 are
missing. `BadDeviceToken` or `Unregistered` remove the device; it registers
again on the next launch.
