# Connect the existing Letm3go project

No new project or plan change is needed. Docker is unnecessary for connecting
the app to a hosted Supabase project.

## Secure CLI authorisation

The wrapper requires `SUPABASE_ACCESS_TOKEN` before it starts the CLI. It never
starts interactive login; login/logout and debug logging flags are blocked. An
exported token takes precedence over the optional dedicated file. Exporting a
token in another terminal does not make it available to the coding agent.

To share your existing token with repository CLI commands, run locally:

```sh
cd /Users/juliuspollak/Projects/letm3go
(umask 077; touch .env.supabase.local)
chmod 600 .env.supabase.local
code --wait .env.supabase.local
```

In that file, enter this assignment, replacing the placeholder with your existing
Personal Access Token, then save and close the editor:

```dotenv
SUPABASE_ACCESS_TOKEN=<paste your existing token here>
```

Do not paste the token into chat, shell command arguments, `.env.local`, or a
`VITE_*` variable. The file must belong to your user and have exactly mode `0600`;
symlinks, extra environment keys and unsafe permissions are rejected. The wrapper
uses Node's `util.parseEnv`, including standard quoting/comment support. It reads
only the token from this file and never echoes it. Errors do not include values.
Missing/blank tokens stop execution before the CLI can fall back to Keychain.
The environment file does not execute shell expressions.

The file is explicitly Git-ignored. Vite exposes only `VITE_*` variables and the
`supabase` Vite mode is reserved/blocked so this dedicated file cannot become a
Vite mode file. The file lives outside `public`/`dist`; Capacitor copies only
`dist` into iOS assets and Xcode does not reference this file. Never copy it into
frontend/native assets. No build script loads this credential file.

Safely check permissions, Git exclusion and authentication without printing the token:

```sh
stat -f '%Lp' .env.supabase.local  # must print 600 on macOS
git check-ignore .env.supabase.local
npm run supabase -- projects list --output-format json
```

Project listing is read-only and displays project metadata, not the access token.
Use the repository wrapper rather than bare `npx supabase`, which bypasses these
guards. No `supabase login` is needed. `.supabase-cli/` remains the ignored,
repository-specific CLI home. An invalid/revoked token still needs replacing;
the wrapper does not obtain or create credentials for you.

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
