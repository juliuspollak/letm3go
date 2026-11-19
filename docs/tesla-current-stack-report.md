# Tesla integration on the current Letm3go stack

20 November 2026. Scope is the existing iPhone app, hosted Supabase and Cloudflare setup. No additional host, paid infrastructure or plan upgrade.

## Decision

**Keep Tesla account linking and vehicle import on the current stack. Phone-independent automatic Tesla trip recording is blocked on that stack as deployed.** Supabase already has the tables to store Tesla trips in the existing activity history. The missing capability is receiving a trusted, live stream directly from the vehicle when the phone is off or absent.

## Current production state

| Capability | Status |
|---|---|
| Link a Tesla account | Live. The last production audit found the OAuth function active and one connected account. |
| Add a Tesla to My Collection | Verified in production by one imported vehicle. The deployed discovery code omits the VIN from its encrypted cache. The recording setup needs that identity before it can bind the vehicle. |
| Store Tesla trips in Supabase | Schema installed. The audited production database had zero vehicle bindings, receiver heartbeats, telemetry events and Tesla-origin trips. |
| Receive Tesla telemetry and create trips with the phone off | Blocked. The recording and ingestion Edge Functions are undeployed, and the current stack has no verified Tesla-compatible receiver. |

Evidence and test results are in the [production audit and pilot runbook](https://github.com/juliuspollak/letm3go/blob/66bffba59c662cd4ef9ec3a6d5df90e181265608/docs/tesla-pilot-runbook.md). [PR #93](https://github.com/juliuspollak/letm3go/pull/93) is open and unmerged.

## Why Supabase storage is only part of the flow

Tesla Fleet Telemetry sends data directly from the car to an internet-facing service. Tesla's official receiver validates the car's client certificate, processes its stream and acknowledges received data. Supabase can receive the resulting authenticated events, reconstruct the drive and store the activity in the same Trips history as iPhone recordings. The vehicle connection comes before those steps. [Tesla Fleet Telemetry](https://developer.tesla.com/docs/fleet-api/fleet-telemetry) · [Tesla receiver](https://github.com/teslamotors/fleet-telemetry)

| Existing option | Assessment |
|---|---|
| Hosted Supabase Edge Functions | They support WebSockets, but workers have a fixed lifetime and can drop open sockets. The current project has no verified way to validate Tesla's vehicle certificates at the connection boundary. The existing ingestion function expects an authenticated HTTPS request from a receiver. [Supabase WebSocket limits](https://supabase.com/kb/troubleshooting/edge-functions-worker-timeouts-and-websocket-drops) |
| Cloudflare website Worker | It handles the public site and OAuth callback. A vehicle connection requires mutual TLS with Tesla-issued certificates. Cloudflare documents Enterprise as a requirement for uploading an external client certificate authority. No suitable configuration on the current deployment was verified. [Cloudflare external client CAs](https://developers.cloudflare.com/ssl/client-certificates/byo-ca/) |
| Scheduled Fleet API reads | Live reads are usage-billed snapshots. They can miss drive boundaries and routes between requests. The cached endpoint carries neither driving state nor location. This does not meet the requirement to reliably record a trip with the phone off. [Tesla vehicle endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints) |
| Existing iPhone GPS | The app can record driving through its current GPS workflow when the phone is present. It cannot record a drive by someone who takes the Tesla without it. |

## Scope for PR #93

The PR has useful changes that fit the current stack, including clearer status, unavailable-action handling, and the VIN-aware vehicle discovery path. Review those independently of the hosted pilot. The receiver and Kafka deployment described in the earlier runbook is outside the current scope. Deploying Edge Functions alone would not deliver phone-independent recording.

The one-car hosting estimate was an optional scenario and does not apply to the approved scope. No new hosting cost is proposed. Tesla API usage remains subject to the existing account and its Fleet API terms. [Tesla billing and limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits)

Keep automatic Tesla recording marked unavailable until a receiver works within the allowed stack and a physical test proves that, with the iPhone off, the vehicle's telemetry produces exactly one Tesla activity in Supabase and the existing Trips view. Synthetic tests establish the reconstruction and persistence behavior only.
