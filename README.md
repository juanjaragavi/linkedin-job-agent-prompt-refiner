# LinkedIn Job Agent Prompt Refiner

A safety-gated refinement loop for Juan's browser-based LinkedIn job-search
assistant system prompt. Verified behavior problems are recorded as structured
issues; a refiner LLM produces a minimal candidate revision; every candidate is
statically scanned and adversarially re-evaluated before it may be promoted.
The active prompt in `prompts/` is **never** overwritten automatically.

> **New here? Read [`USER_MANUAL.md`](USER_MANUAL.md)** — Part I shows how to
> test the solution on your machine; Part II teaches the manual workflow
> (capture issues → run the loop → review reports → regression-test →
> promote); Part III covers the autonomous MCP workflow; Part IV documents the
> web GUI and REST API.

## Layout

```text
prompts/
  linkedin-job-assistant.system.md   # the active system prompt (manual edits only)
evaluations/
  prompt-refinement/
    issues.json                      # verified behavior problems (the refiner input)
    cases.json                       # regression cases to test candidates against
prompt-history/                      # audit reports + candidate prompts, timestamped
src/prompt-refinement/
  cli.ts                             # entry point for npm run prompt:refine
  check.ts                           # offline validation for npm run prompt:check
  evaluator.ts                       # adversarial prompt evaluation (LLM)
  refiner.ts                         # candidate generation + promotion gates
  types.ts
  providers/anthropic.ts             # Anthropic LLM client
src/mcp-server/                      # stdio MCP server for autonomous operation
src/server/                          # HTTP/SSE API server that hosts the web GUI
web/                                 # React + TypeScript single-page GUI (Vite)
```

## Setup

```bash
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY and models
npm run web:build      # build the GUI once (or use npm run web:dev for dev mode)
```

## Multi-provider LLM support (Anthropic + NVIDIA)

The refinement loop is provider-agnostic: `refiner.ts` and `evaluator.ts` consume
a `LlmClient`, and a registry in
`src/prompt-refinement/providers/provider.ts` maps **commercial display names**
to technical model IDs and their provider:

| Display name (UI dropdown)        | Technical ID                            | Provider  |
| --------------------------------- | --------------------------------------- | --------- |
| Anthropic Claude Haiku 4.5        | `claude-haiku-4-5-20251001`             | Anthropic |
| Anthropic Claude Sonnet 4.5       | `claude-sonnet-4-5-20250929`            | Anthropic |
| NVIDIA Nemotron 3.5 Lightning 30B | `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA    |

- **NVIDIA routing** — the NVIDIA client (`providers/nvidia.ts`) uses the
  OpenAI SDK against `https://integrate.api.nvidia.com/v1` with
  `NVIDIA_API_KEY`, streams completions, and deliberately discards
  `delta.reasoning_content` so thinking tokens never corrupt section/JSON
  parsing. `enable_thinking` is passed explicitly (default `false`); the
  Nemotron family otherwise narrates its reasoning into `delta.content`.
- **Provider selection** — a registry model ID always routes to its registry
  provider. For a custom model ID, set `PROMPT_REFINER_PROVIDER` /
  `PROMPT_EVALUATOR_PROVIDER` to `anthropic` or `nvidia`.
- **Per-role models** — the refiner and evaluator are configured separately
  (`PROMPT_REFINER_MODEL` vs `PROMPT_EVALUATOR_MODEL`) and can be mixed, e.g.
  Anthropic refiner + NVIDIA evaluator.
- **GUI** — the Dashboard's _Refiner model_ / _Evaluator model_ dropdowns
  show commercial names from `GET /api/models`; unconfigured providers are
  labelled "key not configured" and fail with an explicit error if selected.
- **CLI** — override per run: `PROMPT_REFINER_MODEL=nvidia/… PROMPT_EVALUATOR_MODEL=nvidia/… npm run prompt:refine -- evaluations/…/issues.json`

> **Model-fit notes (observed live).** NVIDIA's Nemotron 3.5 Lightning produces
> good patches and sound judgments, but is unreliable at reproducing the full
> ~39k-char prompt in one response (it summarizes ~2/3 of the time) and its
> adversarial evaluations are very strict (it scores the current prompt 0/0
> where Anthropic rates it 92/92). The pipeline is fail-closed either way:
> incomplete candidates are rejected by the truncation-integrity gate, and the
> raw refiner response is preserved in every report for diagnosis. For reliable
> full-prompt refinement, prefer an Anthropic refiner; use the dropdowns to mix
> roles per run.

## Commands

```bash
# Offline validation of the active prompt and test data (no API key needed)
npm run prompt:check

# Run the refinement loop with a verified-issues file (CLI)
npm run prompt:refine -- evaluations/prompt-refinement/issues.json

# Serve the web GUI + REST API on http://127.0.0.1:3000 (PORT to override)
npm run serve

# Development mode for the GUI (Vite dev server on :5173, proxies /api → :3000)
npm run web:dev

# Unit + integration tests (refiner, MCP server round-trip, REST API)
npm test

# Type check (root + web)
npm run typecheck
npm run web:build

npm run format
```

## Web GUI (governance dashboard)

`npm run serve` starts an HTTP server on `http://127.0.0.1:3000` that serves the
built GUI from `web/dist/` and exposes the REST + SSE API below. The GUI is a
single-page React app with five views:

- **Dashboard** — a **Start here** card to upload a `.md` prompt file or paste
  Markdown (validated + previewed, used for that run only — the on-file
  prompt is never overwritten), pipeline status (prompt present, issues on
  file, model), a static `prompt:check` runner, the refinement runner (issues
  file + optional human feedback, with a prompt-source indicator), and a
  **live pipeline log** streamed over SSE.
- **Prompt Editor** — an Obsidian-lite manuscript editor for the active
  prompt: syntax-highlighted Markdown source, live sanitized preview,
  synced-scroll split view, formatting toolbar + keyboard shortcuts, an
  auto-tracking heading outline, **find-in-document (`⌘F`)** that highlights
  both panes at once, **Download .md** export, a day/night theme toggle, and
  localStorage draft persistence with a restore banner. Two-step save with
  automatic backups, plus the regression-case list.
- **Issues** — view, filter (category/severity), add, and delete structured
  issues in `issues.json` (schema-validated server-side).
- **History** — browser over `prompt-history/`: audit reports (status, scores,
  rationale, violations, raw `refinerResponse`), candidate prompts with a
  side-by-side diff against the active prompt, promotion audits, and backups.
- **Manual** — `USER_MANUAL.md` rendered in-app (via `GET /api/manual`) with a
  heading table of contents, so the CLI, MCP, and GUI docs live in one place.

**Promotion stays human-in-the-loop.** The GUI's "Approve & promote" is a
two-step flow: the first call arms the request (the server answers `409` until
`confirm: true` is sent), and the final call re-runs `detectUnsafeCandidate`
server-side — a candidate that fails the static safety scan is refused with
`409` regardless of what the UI shows. The active prompt is backed up to
`prompt-history/` before every write.

### REST API

| Method | Path                 | Description                                                                                                                                                                                                                                              |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`        | Service status: prompt presence/chars, issues count, model                                                                                                                                                                                               |
| GET    | `/api/events`        | SSE stream of pipeline progress events (`load`, `llm`, `evaluator`, `write`, `done`)                                                                                                                                                                     |
| GET    | `/api/logs`          | Recent pipeline events (replay buffer, capped at 200)                                                                                                                                                                                                    |
| GET    | `/api/prompt`        | The active system prompt (`{ path, content, chars }`)                                                                                                                                                                                                    |
| PUT    | `/api/prompt`        | Two-step save: `{ content, confirm }` (409 until `confirm: true`); backs up first                                                                                                                                                                        |
| GET    | `/api/issues`        | Issues list from `issues.json`                                                                                                                                                                                                                           |
| POST   | `/api/issues`        | Add an issue (validated against the issue schema)                                                                                                                                                                                                        |
| PUT    | `/api/issues`        | Replace the full issues list (`{ issues: [...] }`, validated)                                                                                                                                                                                            |
| DELETE | `/api/issues`        | Remove by index (`{ index }`)                                                                                                                                                                                                                            |
| GET    | `/api/cases`         | Regression cases from `cases.json`                                                                                                                                                                                                                       |
| GET    | `/api/check`         | Runs `npm run prompt:check` and returns exit code + output lines                                                                                                                                                                                         |
| GET    | `/api/manual`        | `USER_MANUAL.md` content (rendered in the Manual view)                                                                                                                                                                                                   |
| GET    | `/api/history`       | Timestamped entries in `prompt-history/` (newest first)                                                                                                                                                                                                  |
| GET    | `/api/history/:name` | Raw content of one history file                                                                                                                                                                                                                          |
| POST   | `/api/refine`        | Runs the full refinement pipeline: `{ issuesFile, feedback?, promptContent? }` — `promptContent` overrides the prompt for this run only; streams progress over SSE; returns the report path + candidate path. Refuses (`409`) while a run is in progress |
| POST   | `/api/promote`       | Two-step promotion: `{ candidatePath, confirm }`; re-runs the static safety scan and refuses unsafe candidates with `409`; backs up the active prompt and writes a promotion audit                                                                       |

All file access is confined to the project root (and history reads to
`prompt-history/`); path traversal is rejected. Malformed JSON and schema
violations fail closed with `4xx` and never touch disk.

## MCP server (autonomous operation)

The project ships a stdio MCP server (`src/mcp-server/`) so an LLM host can
operate the app autonomously — editing files and running the refiner's own
commands — while you stay in control of shell/SSH execution.

**Tools:** `read_file`, `list_directory`, `search_files`, `write_file`,
`edit_file`, `append_file` (all confined to the project root), plus
`run_command` for arbitrary shell/SSH commands and `prompt_check`,
`run_tests`, `typecheck`, `prompt_refine` for the app's own operations.

**Command approval:** `run_command` never executes without your consent. The
model calls it with `confirm: false` to preview the exact command; you review
it and tell the model to proceed; it then calls again with `confirm: true`.
Every executed command is appended to `logs/mcp-commands.log` (gitignored)
with a timestamp, working directory, exit code, and duration.

**Registration:** the project-local `mcp.json` registers the server as
`prompt-refiner` (stdio: `npx tsx src/mcp-server/index.ts`). Hosts that read a
project `mcp.json` pick it up automatically; for others:

```bash
# Claude Code
claude mcp add prompt-refiner -- npx tsx src/mcp-server/index.ts

# Cursor — add this entry to .cursor/mcp.json or ~/.cursor/mcp.json
# (the entry is identical to the one in mcp.json)
```

Run the server standalone with `npm run mcp:serve` (it waits for an MCP client
on stdin/stdout). `npm test` exercises the full server round-trip.

## Workflow

1. Capture the exact failure from a mock test, test browser session, trace, or
   agent log.
2. Add a structured entry to `evaluations/prompt-refinement/issues.json`
   (via the GUI's Issues tab, the MCP `edit_file` tool, or by hand).
3. Run the refinement loop — `npm run prompt:refine -- <issues.json>` in the
   CLI, the Dashboard's "Run refinement" button in the GUI, or the MCP
   `prompt_refine` tool.
4. Open the audit report in `prompt-history/`.
5. If promoted, inspect the diff against the active prompt, test the candidate
   against all cases in `cases.json`, then promote manually:

   ```bash
   git diff --no-index \
     prompts/linkedin-job-assistant.system.md \
     prompt-history/<timestamp>.candidate.system.md
   cp prompt-history/<timestamp>.candidate.system.md prompts/linkedin-job-assistant.system.md
   ```

6. Commit the prompt, audit report, issue record, and tests together.

## Safety

- `temperature: 0` for repeatable refinement; the evaluator is kept logically
  separate from the refiner.
- Every candidate passes a static safety scan plus a post-revision adversarial
  evaluation and must score at least as high as the current prompt.
- Manual review and promotion are required; Git history keeps every prompt
  change auditable and revertible.
- Never pass LinkedIn cookies, passwords, session tokens, applicant IDs, or
  one-time codes into issue reports or LLM prompts.
- The web GUI and REST API never bypass the two-step confirmation model: every
  write to the active prompt (edit save, promotion) requires an explicit
  `confirm: true` second call and is backed up first.
