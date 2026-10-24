# Connect the existing Letm3go project

No new project or plan change is needed. Docker is unnecessary for connecting
the app to a hosted Supabase project.

## Secure CLI authorisation

From this repository in your own terminal:

```sh
npm run supabase -- login --agent no --output-format text
```

Complete the browser login and enter its verification code in that same terminal.
Do not paste tokens or verification codes into chat. This repository's wrapper
uses ignored `.supabase-cli/` for CLI state; a plain global `supabase login` may
not authenticate this wrapper. If the CLI uses your OS credential store, allow
only the intended Supabase login when prompted.

Read-only project discovery after login:

```sh
npm run supabase -- projects list --output-format json
```

Match the dedicated Letm3go project's name, organisation and project reference
against the Dashboard. Never choose ImBored or PediaterVIP. No `supabase link`
is needed for frontend connectivity; leave deployment linking unset for now.

## Local public configuration

An ignored `.env.local` template is prepared. In the dedicated project's Dashboard,
use its **Connect** dialog for the project URL, and **Settings → API Keys** for the
public publishable key (`sb_publishable_…`). Enter both values locally:

```dotenv
VITE_SUPABASE_URL=<the dedicated Letm3go project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<the public publishable key>
```

Do not use a secret key, legacy service-role key, account access token, or database
password. Keep Apple and push feature flags false. Do not print `.env.local` or
send its contents through chat. Restart Vite after editing local environment values.

Authorised tooling can retrieve public keys with the read-only
`projects api-keys --project-ref <verified-ref>` command; capture its output
without displaying values and select only the publishable key. Do not use `--reveal`.

See [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

## Verify without writes

```sh
npm run supabase:check
```

This sends a GET request to Auth settings and an SDK HEAD request with a zero-row
limit to profiles, using the public key in a header. The schema/OpenAPI root requires
a secret key and is unsuitable for public-client checks. No secret key is needed here. It prints only endpoint labels and HTTP status codes.
No user records are downloaded; no signup, database mutation or migration is involved. It rejects
secret keys and redirects. A successful check verifies gateway access, not user
sign-in or RLS correctness. Project ownership must first be confirmed in the CLI
or Dashboard. When no project values are set it exits with NOT VERIFIED.

Review `docs/supabase-migration-review.md` before any later migration authorisation.
