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

One pipeline: an outbox in the database, drained by one Edge Function, which the
database calls. The app never calls it.

1. A trigger writes a row to `notifications` in the same transaction as the
   feedback, message, status change, submission or poke.
2. **Immediately**: a statement trigger on `notifications`
   (`20261124000000_push_dispatch.sql`) makes one asynchronous `pg_net` request
   to `send-push-notifications`, authenticated with the worker secret. There's
   one request per transaction, and `pg_net` sends it after commit. This works
   while every app is closed.
3. The function (`handler.js`) claims due deliveries under a lease
   (`claim_push_deliveries`). It fans each new notification out to the
   recipient's registered devices (`push_devices`, bound to a live login session)
   and sends them via APNs (production for TestFlight and App Store builds,
   sandbox for Debug builds). Each result is recorded (`finish_push_delivery`).
4. **Recovery**: every 5 minutes `pg_cron` runs `dispatch_due_pushes()`. It
   calls the function only when something is due: a retry, an expired lease or
   a dispatch that failed. An idle outbox costs one indexed query and no request.
5. Temporary failures retry with backoff (30 s, 1 min, 2 min, 4 min) for at most
   5 attempts. Dead device tokens are removed. Pushes older than a day, or
   already read in the app, are not sent. A rejected APNs key (403) is retried
   with a fresh token, without calling Apple again in that batch.
6. Read notifications older than 60 days are removed when that person next
   receives one. Pokes older than a day are removed on the next poke.

The badge on the app icon is the unread count when the last push arrived and is
cleared when the app opens; the profile bubble shows what is still unread.
Opening Feedback & Support marks feedback notifications read; opening Trails →
Review marks review notifications read; a poke banner is read when dismissed.

Pokes: friends or same household only, one per person per minute, 60 per hour.

## One-time setup

1. Apply the migrations (with the usual ledger check first):

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

3. Create the worker secret, the shared password between the database and the
   function. Store it in both places, and never print or commit it:

   ```bash
   SECRET="$(openssl rand -hex 32)"
   npm run supabase -- secrets set --project-ref subobfmlkfqcsaekygat PUSH_WORKER_SECRET="$SECRET"
   npm run supabase -- db query --linked "select vault.create_secret('$SECRET','push_worker_secret'); select vault.create_secret('https://subobfmlkfqcsaekygat.supabase.co/functions/v1/send-push-notifications','push_worker_url');"
   unset SECRET
   ```

4. Deploy the function:

   ```bash
   npm run supabase -- functions deploy send-push-notifications --project-ref subobfmlkfqcsaekygat
   ```

5. On the iPhone, allow notifications when the app asks, which happens once
   after sign-in. You can also turn them on later in Account & settings, which
   shows whether this iPhone registered.

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
missing, and `InvalidProviderToken` means Apple refused the key. `BadDeviceToken`
or `Unregistered` remove the device; it registers again on the next launch.

Ask Apple whether it accepts the key, without sending to any phone (an all-zero
device token; `credentialsAccepted: true` means the key and topic are right):

```bash
curl -s -X POST https://subobfmlkfqcsaekygat.supabase.co/functions/v1/send-push-notifications \
  -H "Authorization: Bearer $PUSH_WORKER_SECRET" -H 'Content-Type: application/json' -d '{"mode":"apns-check"}'
```

Recovery job and recent dispatches:

```sql
select jobname,schedule,active from cron.job where jobname='letm3go-push-recovery';
select id,status_code,created from net._http_response order by id desc limit 10;
```

## Reused from ImBored

| ImBored | letm3go | |
| --- | --- | --- |
| `notification_events` + `notification_deliveries` outbox, `claim_push_deliveries` (lease, `skip locked`, 5 attempts), `finish_push_delivery` (backoff, invalid token) | `notifications` + `notification_deliveries`, same two functions (`20261123000000`) | Adapted: the event table is also the in-app inbox (`read_at`); devices are letm3go's session-bound `push_devices` |
| `queue_social_push_event` triggers, `pokes` | `notify_*` triggers, `send_poke` | Adapted to feedback, segments and letm3go friends/household |
| `send-push-notifications/handler.ts`, `apns.ts`, `workerCore.ts` | `handler.js`, `apns.js` | Reused: worker-secret `constantTimeEqual`, APNs classification, ES256 provider token cache, per-delivery finish, metadata-only logs. Adapted: bundle ID, letm3go routing fields |
| `apns-auth-check` mode | `apns-check` mode | Adapted: asks Apple with a dummy token instead of only signing locally |
| `.github/workflows/send-push-notifications.yml` (GitHub cron, `*/5`) | `pg_cron` `letm3go-push-recovery` | Replaced: GitHub ran ImBored's schedule 3–5 hours apart; the database job runs on time and only calls when due |
| client `wake` mode + rate limit (`pushWake.js`) | not used | Replaced by the database insert trigger, so the app never calls the function |
| `sandbox-self-test`, `empty-check`, schema-drift repair migrations | not needed | ImBored-specific diagnostics and repairs |
| `PushNotifications` registration, tap routing | `pushAccount.js`, `nativeNotifications.js`, `notifications.js` | letm3go's existing session-bound registration kept |

