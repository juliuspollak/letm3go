# Personal segment results and offline Watch feedback

The rider confirmed three real Zoonotica passes on 13 November. Three attempts on one ride is correct; the previous wording and scoped history made the result unclear.

The activity detail now uses the owner's complete available native activity history, displays the clean personal best with date and source ride, and compares this ride's best with strictly earlier clean attempts. A section whose matching failed cannot manufacture a PR. Overlapping recordings of the same physical attempt prefer the deliberate Watch recording; separate laps remain separate. Public current geometry supersedes an older local definition, and directions have separate results.

The phone builds an owner-scoped Watch catalogue from saved sections and nearby approved public segments, using the last actual recorded location. Public geometry and direction are joined only when their versions agree. The catalogue is bounded to 128 definitions and 32,768 reference vertices, transferred as a file and retained offline. Geometry and PRs are frozen once a live attempt has started. PRs reflect clean attempts in recordings available on the phone, rather than claiming complete cloud history on a new device.

The Watch follows the reference incrementally. Start/finish feedback includes the segment name, cached PR and result comparison. Pauses or recording gaps invalidate PR comparison. Each event carries its own feedback, including when segments overlap. Foreground feedback uses Watch haptics; screen-off feedback uses local notifications after the rider enables permission. Actual background delivery, Focus settings and haptic perception still need an outdoor Watch trial.

Replay of the rider's private GPS recording (kept outside the repository) produced three Zoonotica finishes: 377, 287 and 357 seconds, plus Captain Table at 353 seconds, matching the completed-recording matcher. Synthetic regression tests cover direction, repeated laps, departures, interruption, catalogue bounds and account isolation. React tests cover delayed work after account/history changes and retry after lookup failure.

This change does not rewrite existing cloud leaderboard efforts. Historic overlapping cloud submissions and cloud-only history recovery remain separate concerns. No production segment data was changed. No TestFlight release is authorised while the previously identified recovery blocker remains open.

## Final verification

- `npm run check`: passed; 2,009 tests across 215 files; orchestrator 52 passed and 11 Windows-only skips; lint and build passed. Existing bundle warnings remain.
- Added full-history native request regression: 10 React detail tests passed.
- `npm run test:native`: 2,230 assertions passed.
- `npm run test:native:details`: 124 assertions passed against the updated presentation fixture.
- Simulator and signed physical iPhone/Watch builds passed.
- `git diff --check`: passed.
- Installed and launched the signed debug app on Julius's iPhone without deleting its data. Direct Watch installation was rejected by CoreDevice with Developer Mode disabled (10005); physical Watch installation and outdoor validation remain pending. No TestFlight upload was made.
