# Tesla linking and automatic recording status

19 November 2026, Sydney time. Reviewed Letm3go main at `08a8b93`, the linked production Supabase project, the public website and Tesla's current Fleet API documentation.

## Verdict

**Tesla account linking is deployed and has stored an account authorization. Adding a vehicle to My Collection still needs a live acceptance check. Automatic Tesla trip recording is blocked by missing deployed services and receiver setup.**

Production has one Tesla account marked connected and one stored credential record. The recorded access-token expiry has passed. Letm3go refreshes expired access tokens during vehicle discovery, so the stored expiry by itself cannot establish whether reconnecting is necessary. No linked Tesla vehicle was present in the production Collection at the time of the audit.

| Stage | Verified on 19 November | Outstanding |
|---|---|---|
| Public Tesla domain and key | The website and public-key endpoint returned HTTPS 200. The public key parsed as P-256. The callback route returned HTTP 400 for a request without OAuth parameters, as expected. | Confirm the exact registered callback and regional partner registration in the Tesla developer portal. The public key's availability alone does not establish partner registration. |
| Tesla account authorization | Production Edge Function `tesla` is active at version 5. An unauthenticated status request received 401. OAuth configuration and the credential encryption secret are present by name. The refresh-lease table exists. Production has one connected record and one credential record. | Verify an authenticated app session from authorization through return to the iPhone. Confirm the stored refresh grant still works on the next authorized discovery request. |
| Vehicle discovery and import | The app implements Tesla discovery, multi-select and saving to My Collection. The server looks up vehicles with the signed-in user's credential and only accepts selection from that user's discovered list. Production contains zero Tesla-linked vehicle rows. | Confirm the value of the existing `TESLA_API_READS_APPROVED` setting and the Tesla developer application's billing status and limit. Run one approved live discovery and save a vehicle, then reopen My Collection to verify it persists. |
| Database for automatic Tesla trips | The fleet schema is present. There are zero vehicle bindings, normalized fleet events and Tesla-source activities. No receiver heartbeat has ever been stored in the checked production table. | Validate the deployed schema and data retention together with the pilot deployment. |
| Automatic recording APIs and receiver | The repo includes `tesla-recording`, `telemetry-ingest` and a single-host receiver package. Neither function is deployed in the linked project. No receiver, signing gateway or setup approval configuration was listed among the project secrets. | Deploy the two functions and provision the official Tesla Fleet Telemetry receiver, Kafka consumer, and signing gateway with TLS, credentials and monitoring. Confirm a fresh heartbeat before attempting vehicle configuration. |

## Finish linking a vehicle first

1. In the Tesla developer portal, confirm app access, the regional partner registration, the registered OAuth redirect, the payment method and the Fleet API spending limit. Tesla lists Australia under the Asia-Pacific region served by `https://fleet-api.prd.na.vn.cloud.tesla.com`. The repository's intended public redirect is `https://letm3go.au/auth/tesla/callback`. Compare it with the actual portal and Edge configuration before changing anything. [Tesla regions](https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries) · [Tesla third-party OAuth](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens) · [Tesla billing and limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits)
2. On the signed-in iPhone, open **Profile → My Collection → Tesla**. If already marked **Connected**, try **Choose Tesla vehicles** after the operator confirms Fleet reads. This call can refresh the stored token. If Tesla rejects the grant, run **Connect Tesla** again and retry discovery.
3. Select the vehicle and add it. Verify that the vehicle remains in My Collection after reopening the app. If this is being rolled out to other accounts, verify vehicle ownership isolation with a second authorized test account.

The receiver and virtual key are only needed when moving on to automatic vehicle recording, subject to the vehicle's compatibility. The account-linking flow requests device data and refresh access, with vehicle-location access optional at sign-in. [Tesla scopes](https://developer.tesla.com/docs/fleet-api/authentication/overview)

## Automatic recording pilot

- Set up the public mTLS receiver and private consumer, deploy the missing APIs, configure the gateway and verify a current heartbeat. Review retention, hosting costs and Tesla's billing limits before enabling a vehicle. The repo's Compose package is intended for one pilot host. [Tesla Fleet Telemetry setup](https://developer.tesla.com/docs/fleet-api/fleet-telemetry)
- On the selected vehicle, confirm firmware and compatibility, obtain the required location grant, and pair the virtual key or enable the in-car data-streaming setting where applicable. Verify Tesla has adopted the signed configuration for the intended receiver. [Tesla virtual keys](https://developer.tesla.com/docs/fleet-api/virtual-keys/overview) · [Tesla vehicle endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints)
- Confirm a real drive sends telemetry after activation, produces one persisted Tesla journey and appears in the app. Then verify disable and disconnect behavior, consent boundaries, and reconciliation with an overlapping iPhone GPS recording. In particular, the disable path can stop accepting data locally while remote stream removal is pending. Verify the remote configuration is gone before treating streaming charges as stopped.
- Before expanding beyond the pilot, verify recovery from a receiver restart, monitoring, retention, and ingestion throughput under realistic multi-vehicle load.

## Evidence and limits

- 48 focused local tests passed covering Tesla connection UI, credentials, fleet processing, reconciliation and the fleet database. They use mocks or local data.
- Supabase checks read function metadata, configuration names and aggregate database state. Tesla developer-portal registration, payment settings, live refresh, vehicle discovery and physical driving were outside this read-only check. No billable Fleet requests, deployments or production settings changes were made.
- The older `tesla-connection-readiness.md` and `tesla-fleet-recording.md` documents describe earlier stages. Use this report for current deployment status and the older documents for implementation and deployment detail.
