# Operational workflow verification

This result supersedes the blocked infrastructure audit at `b7e6c66`. The current implementation follows the requested simple, trusted local-worktree execution model; no external sandbox or monetary-budget framework is required to launch it.

Branch: `fix/ai-orchestrator-audit`. Worktree: `/private/tmp/letm3go-orchestrator-audit`.

## VERIFIED — actual three-agent execution

Executed:

```sh
export PATH="$HOME/.npm-global/bin:$PATH"
node scripts/ai-orchestrate.mjs --integration-test
```

Evidence directory: `.build/ai-orchestrator/2026-11-01T12-45-23-793Z/` in the worktree. It contains original requirements, all developer/reviewer prompts, three real Cline logs, three Codex reports/logs, three Claude reports/logs, test logs, the original fixture before injection, injected-defect description, final fixture and final summary. These generated artifacts are intentionally ignored rather than committed as application source.

Cline 3.0.74 was invoked with `--provider deepseek --model deepseek-v4-flash --json --yolo`; the saved direct-provider profile was validated before execution. Cline authenticated and created the fixture. Codex 0.166.0 and Claude Code 2.1.309 each performed real separate reviews on every cycle. All nine agent invocations exited zero; passing decisions still depended on their structured findings and actual tests.

| Cycle | Real Codex review | Real Claude review | Executable tests | Result |
| --- | --- | --- | --- | --- |
| 1 | Fail: subtraction defect | Fail: subtraction defect | Fail: -1 instead of 5 | Findings and test evidence returned to Cline |
| 2 | Fail: negative-zero normalization | Fail: negative-zero normalization | Pass: original assertion cases | Both findings returned to Cline |
| 3 | Pass, no findings | Pass, no findings | Pass | VERIFIED |

The deliberate subtraction defect was injected **after** Cline's first implementation, before either review. The second defect was found independently by both reviewers despite passing initial deterministic tests. The fixture was corrected again and freshly reviewed. Additional final executable assertions for negative zero and numeric overflow passed. The integration command now includes those edge cases by default.

Final report: `.build/ai-orchestrator/2026-11-01T12-45-23-793Z/summary.json`. No application source, production service, remote SQL, push, merge or deployment was involved in this task.

## VERIFIED — project checks

- `npm run test:orchestrator`: 31 passed, 0 failed.
- `npm run check`: passed orchestrator tests, ESLint, all 136 existing Vitest files / 896 tests, and Vite production build.
- `npm run test:native`: 1,738 native recorder/auth assertions passed.
- `node scripts/ai-orchestrate.mjs --preflight` with Cline on PATH: required CLI help flags and installed versions passed; direct DeepSeek profile validated. Preflight alone does not claim authentication.
- `--dry-run --task-file /Users/juliuspollak/Projects/letm3go-ai/activity-experience-v2.md`: preserved all 26,657 bytes; SHA-256 `32d263c49a2b3bd775ad9139af71fde16d5f81b47a8db3da9544c8117c977ee8`. No agents launched for that specification.
- `git diff --check`: passed.

An initial full check failed because Vitest collected the Node-only orchestrator suite. The suite is now named `ai-orchestrate.node.mjs`, runs through `test:orchestrator`, and is included explicitly in `check`. All existing Vitest tests still run. No failing test was disabled.

## SIMULATED — failure-path regressions

Deterministic substitutes test complete requirements/feedback transfer, independent reviews, deduplication without severity reduction, no-change rejection, branch changes, reviewer/check mutation, local developer commits, retry exhaustion, missing test evidence, malformed/contradictory JSON and failed Claude envelopes. Real local subprocess tests additionally exercise nonzero exits, absent executables, timeout and excessive output. Provider-auth exceptions in lifecycle tests remain simulations; they do not claim a real authentication outage was tested. An actual SIGTERM during a disposable CLI preflight was also tested: it terminated the process group, produced BLOCKED and released the lock; no paid model request was used for cancellation testing.

## Scope and limits

This is an operational **trusted local CLI workflow**, not an adversarial security boundary. Agents run in the existing linked worktree with explicit local-only instructions; a worktree shares Git metadata and does not enforce filesystem confinement. The orchestrator issues no prohibited remote operation and omits inherited production environment credentials. User CLI authentication remains available through HOME. Timeouts and attempt limits are execution safeguards, not guaranteed monetary limits.

No automatic phase planning/resumption framework was added. Full requirements and every completed cycle remain in the report for manual inspection/restart. No simulator, UI journey or physical-device acceptance was performed. Activity Experience v2 has **not** been started.

## Independent implementation review

A separate real Codex review inspected the complete runner, tests and surrounding configuration. It found four defects: descendant cleanup waiting on inherited pipes, insufficient proof that integration reviewers detected the seed, lock-conflict reports left RUNNING, and cancellation during synchronous preflight. All four were fixed with regression tests. The final runner uses cancellable asynchronous preflight, cleans process groups on child exit, blocks inaccurate seed-detection claims, and reports lock conflicts truthfully. The independent re-review passed with zero findings; see `.build/orchestrator-final-review-2.json` and its log. It also ran 25 read-only-compatible tests and targeted ESLint. The full 31-test suite, including filesystem/process tests, passed separately through the normal test command.

## Final real run after review fixes

Re-executed `--integration-test` against the corrected runner. Final evidence is `.build/ai-orchestrator/2026-11-01T12-53-04-664Z/summary.json`.

| Cycle | Codex | Claude | Expanded executable tests |
| --- | --- | --- | --- |
| 1 | Fail: seeded subtraction | Fail: seeded subtraction | Fail |
| 2 | Pass, no findings | Pass, no findings | Pass |

Final status: **VERIFIED**. All six actual agent invocations exited zero. Both first-cycle reviewers explicitly identified the subtraction defect; the integration proof gate accepted that evidence and the real failing assertion. Cline received all findings and the failing test, corrected the fixture, and both agents independently re-reviewed it. The expanded assertion cases include signed zero and numeric overflow. The final complete `npm run check` also passed 31 orchestrator tests, all 896 existing tests, lint and build after the code-review fixes. The native suite passed 1,738 assertions; native code was unchanged.
