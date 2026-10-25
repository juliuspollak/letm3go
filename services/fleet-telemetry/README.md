# Letm3go Fleet receiver package

**Prepared, not deployed.** Do not start these containers, add DNS or configure a real
vehicle until the operator approves the infrastructure, database migration, secrets
and billable operations. See `../../docs/tesla-fleet-recording.md` for exact steps,
costs, current verification and production blockers.

- Tesla official receiver commit: `bd076fe1494841707528449560c4a19d0d426da4`.
- Tesla official command proxy commit: `fc5a1910ad45c42921d541089e3e366d0b897f52`.
- `receiver.json`: Tesla production client-CA validation remains built into the
  unmodified official receiver; no custom unauthenticated receiver was written.
- `consumer.mjs`: private Kafka JSON/VIN-key consumer → timestamped HMAC → Supabase.
  Offsets are committed only after stored projection or durable rejected-frame output.
- `control.mjs`: separate signed-configuration-only HTTPS/HMAC gateway to the official
  command proxy. No wake/unlock/start/climate/general vehicle-command route exists.
- `compose.yaml`: single-host pilot topology with persistent Kafka; **not an HA
  production deployment**. Only 443 (vehicle mTLS) and 8443 (control HTTPS/HMAC) publish.
- `.dockerignore` at repository root allowlists only required service source: no app
  credentials, journey data or signing keys enter the Docker build context.

The existing Tesla P-256 key is mounted read-only into the official signer only.
TLS certificates/keys are separate from that registration/signing key. Do not
regenerate the Tesla key. No real secret templates have been populated here.
