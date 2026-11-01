# Letm3go local multi-agent development loop

**Status:** Starter orchestration, not yet executed on the owner's Mac. DeepSeek model selection must be configured in Cline CLI separately. No agent work is automatically pushed, merged, deployed or migrated.

## Setup on Mac
1. Install Node 24, dependencies (`npm ci`), Xcode CLI tools, Cline CLI, Codex CLI and Claude Code CLI (the official VS Code Claude Code extension can provide the `claude` command).
2. Run `cline auth` and configure its provider/model to **DeepSeek**. The VS Code extension's model selection may not automatically transfer to a separate Cline CLI profile: verify with a harmless CLI task first.
3. Run `codex login` and verify `codex exec --sandbox read-only "Say READY"`.
4. Sign into Claude Code in VS Code and verify `claude -p "Reply READY"` in the integrated terminal. The extension UI itself is not a programmable cross-agent handoff; the CLI is used for orchestration.\n5. Create a clean feature branch based on current main and ensure `git status --short` is empty.
5. Run from the repository root:

```sh
node scripts/ai-orchestrate.mjs --dry-run "Improve MTB segment editing"
node scripts/ai-orchestrate.mjs "Improve MTB segment editing"
node scripts/ai-orchestrate.mjs --ios "Improve MTB segment editing"
```

## Behaviour
- Cline implements and revises on the **current branch**.
- Codex independently reviews architecture/security/integration in a read-only sandbox with structured JSON findings.\n- Claude Code independently reviews QA risks, regression coverage, edge cases and UI/device acceptance, using a restricted plan-mode CLI session. A valid pass from **both** reviewers is required. Claude failures and findings are fed back to Cline; invalid output stops the run.
- The orchestrator runs `npm run check` and `npm run test:native` each cycle.
- `--ios` also performs unsigned iOS sync and simulator-targeted build; **it does not yet run XCUITest UI journeys or Watch/hardware tests**.
- Codex or Claude findings, and test failures, go back to Cline, up to three attempts (override `AI_MAX_CYCLES=1..5`).
- Logs and review output are under ignored `.build/ai-orchestrator/<timestamp>/`.
- Codex passes do **not** mean the UX or hardware behaviour is correct. The pipeline does not automatically approve merge.

## Important safety and reliability limitations
This is a local process runner, **not a sandbox boundary**. Both review prompts enforce read-only behaviour; Claude plan mode and disallowed writing/shell tools are additional protections, not an OS sandbox. Cline's `--auto-approve true` allows tools and commands without intervention. Use a dedicated low-privilege local account/worktree with no production tokens or linked Supabase secrets. Review the scope before enabling auto-approval. Do not allow CLI agents production write credentials.

Claude CLI compatibility and permission flags must be checked against the installed version. The **VS Code extension alone does not enable background cross-agent messaging**.\n\nNo command execution from this chat takes place on your Mac. A successful local dry run does not prove the agents or simulator work. The `--ios` checks compile the app, not visually inspect or tap it. Actual UI automation requires authored XCTest/XCUITest test cases (or an evaluated simulator automation MCP server); these should be added before describing simulator QA as autonomous.

A clean working tree is required to avoid overwriting teammates' changes. Review output and deterministic checks gate completion; findings can still be missed. The CLI versions and exact flags should be verified on your installed versions before real use.
