# Local three-agent workflow

The runner uses the installed Cline, Codex and Claude Code CLIs in the current isolated Git worktree:

**Cline / DeepSeek → independent Codex review → independent Claude QA review → deterministic tests → Cline fixes → repeat (at most five cycles).**

## Setup and use

Use Node 24, install dependencies with `npm ci`, and authenticate the CLIs locally:

- `cline auth deepseek`: configure a direct DeepSeek provider and model. The runner reads the saved model from `~/.cline/data/settings/providers.json` and passes `--provider deepseek --model <saved-model>` explicitly. It refuses absent or unauthenticated direct DeepSeek profiles, even if another provider is last used. It never puts API keys on command lines or in reports.
- `codex login`
- `claude auth login`

Ensure all three executables are on PATH. For this Mac, Cline needs `export PATH="$HOME/.npm-global/bin:$PATH"`.

From the isolated worktree, run:

```sh
npm run test:orchestrator
node scripts/ai-orchestrate.mjs --preflight
node scripts/ai-orchestrate.mjs --integration-test
node scripts/ai-orchestrate.mjs --dry-run --task-file /absolute/path/activity-experience-v2.md
node scripts/ai-orchestrate.mjs --run --task-file /absolute/path/activity-experience-v2.md
```

The last command **starts implementation**. It is documented for later use; this infrastructure task does not run Activity Experience v2. Ordinary runs require a clean linked worktree on a feature branch. Local edits, tests and commits are allowed; changing branches stops the run. The orchestrator never invokes push, merge, deployment or remote SQL, and every developer prompt explicitly prohibits them. Use trusted installed CLIs; a Git worktree is not an OS security sandbox.

## Checks and repair

Both reviewers must return complete structured JSON, have zero findings, and leave the reviewed source unchanged. Codex runs with its read-only sandbox. Claude runs in restricted plan mode with Read/Glob/Grep only; deterministic tests execute directly after Claude's QA review so they have explicit exit codes and logs. Claude's structured-output envelope is checked for successful completion. A successful CLI exit alone cannot approve a task.

Normal runs execute `npm run check` (lint, Vitest, web build) and `npm run test:native` each cycle. Failed assertions/build checks return to Cline with logs and both reviews. An agent failure, invalid review, missing executable, timeout, output overflow or unavailable required check stops the run. Tests and both reviews run again after every repair. Zero actionable findings and passing checks are required at the same reviewed source revision.

The real integration command works only on an ignored `.build/ai-orchestrator/<run>/fixture/addition.cjs`. Cline first implements addition. The harness saves that implementation and deliberately replaces it with subtraction before the two real reviews. The independent findings and a real failing Node assertion go back to Cline, followed by fresh reviews and assertions. This is a small real handoff test, not app or device acceptance.

## Logs and limits

Each run stores the complete original task, prompts, CLI logs, structured reviews, injected defect evidence (integration only), test output, execution exit codes and final `summary.json` in `.build/ai-orchestrator/<timestamp>/`. Requirements are never truncated in repair or review prompts; stdin avoids command-line length limits. Reports distinguish `DRY_RUN`, `RUNNING`, `REPAIR_REQUIRED`, `VERIFIED` and `BLOCKED`.

`AI_MAX_CYCLES=1..5` sets attempts (default 5). `AI_STEP_TIMEOUT_SECONDS=1..5400` sets each invocation's timeout (default 900 seconds). Each CLI's combined output is limited to 8 MiB. Cancellation and timeout kill the active process group and preserve a blocked report. These are execution limits, **not guaranteed monetary caps**. The runner passes a small environment allowlist instead of inheriting production service keys or Git overrides; installed CLI authentication still uses the user's normal local CLI profiles.

A per-worktree lock prevents overlapping runs. After a crash, inspect the PID in `.build/ai-orchestrator/active.lock`; remove that lock only after confirming the process has exited. There is no automatic resumption or phase framework. Inspect the durable report, commit reviewed partial work if appropriate, and restart with the full specification. Logs are local and ignored; review them before sharing.

Preflight verifies versions, required help flags and the saved DeepSeek profile. Authentication/network failures are verified by actual invocations and stop the run with the exact failed stage and log. `VERIFIED` means both independent reviews and configured checks passed; it does not mean simulator, hardware or manual UX acceptance passed.
