# Letm3go local multi-agent development loop

**Status:** Starter orchestration, not yet executed on the owner's Mac. DeepSeek model selection must be configured in Cline CLI separately. No agent work is automatically pushed, merged, deployed or migrated.

## Setup on Mac
1. Install Node 24, dependencies (`npm ci`), Xcode CLI tools, Cline CLI and Codex CLI.
2. Run `cline auth` and configure its provider/model to **DeepSeek**. The VS Code extension's model selection may not automatically transfer to a separate Cline CLI profile: verify with a harmless CLI task first.
3. Run `codex login` and verify `codex exec --sandbox read-only "Say READY"`.
4. Create a clean feature branch based on current main and ensure `git status --short` is empty.
5. Run from the repository root:

```sh
node scripts/ai-orchestrate.mjs --dry-run "Improve MTB segment editing"
node scripts/ai-orchestrate.mjs "Improve MTB segment editing"
node scripts/ai-orchestrate.mjs --ios "Improve MTB segment editing"
```

## Behaviour
- Cline implements and revises on the **current branch**.
- Codex independently reviews in a read-only sandbox with structured JSON findings.
- The orchestrator runs `npm run check` and `npm run test:native` each cycle.
- `--ios` also performs unsigned iOS sync and simulator-targeted build; **it does not yet run XCUITest UI journeys or Watch/hardware tests**.
- Failures go back to Cline, up to three attempts (override `AI_MAX_CYCLES=1..5`).
- Logs and review output are under ignored `.build/ai-orchestrator/<timestamp>/`.
- Codex passes do **not** mean the UX or hardware behaviour is correct. The pipeline does not automatically approve merge.

## Important safety and reliability limitations
This is a local process runner, **not a sandbox boundary**. Cline's `--auto-approve true` allows tools and commands without intervention. Use a dedicated low-privilege local account/worktree with no production tokens or linked Supabase secrets. Review the scope before enabling auto-approval. Do not allow CLI agents production write credentials.

No command execution from this chat takes place on your Mac. A successful local dry run does not prove the agents or simulator work. The `--ios` checks compile the app, not visually inspect or tap it. Actual UI automation requires authored XCTest/XCUITest test cases (or an evaluated simulator automation MCP server); these should be added before describing simulator QA as autonomous.

A clean working tree is required to avoid overwriting teammates' changes. Review output and deterministic checks gate completion; findings can still be missed. The CLI versions and exact flags should be verified on your installed versions before real use.
