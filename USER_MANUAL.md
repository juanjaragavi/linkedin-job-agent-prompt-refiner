# User Manual — LinkedIn Job Agent Prompt Refiner

This manual has four parts:

- **Part I — Test the solution** (start here): verify the project actually works
  on your machine, first offline (no API key needed), then live with the
  Anthropic API, and finally through the web GUI.
- **Part II — Use the solution (manual workflow)**: the full workflow for
  safely improving `prompts/linkedin-job-assistant.system.md`, run by hand
  from the terminal.
- **Part III — The autonomous workflow (MCP)**: how the LLM in charge of the
  application's logic runs that same workflow itself using MCP tools — editing
  files, driving the refiner, and proposing commands — while you approve every
  shell/SSH command and the final promotion.
- **Part IV — The web GUI and REST API**: the visual governance dashboard —
  pipeline monitoring, issue management, prompt editing, diff review, and
  promotion — plus the HTTP/SSE API behind it.

**One core rule across every mode.** The tool never edits the active prompt on
its own, whether you operate by hand (Part II), through the MCP agent (Part
III), or through the GUI (Part IV). It produces a _candidate_, an audit report,
and a rationale. Command execution and the final promotion are always human
decisions — nothing ships without you.

**Project root:** `/Users/macbookpro/GitHub/linkedin-job-agent-prompt-refiner`
(open this folder in your editor — it is the local copy you have open).

---

## Part I — Test the solution

### 1.1 Prerequisites

| Requirement                    | Check command                                      | Expected                                             |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| Node.js 20 LTS+                | `node -v`                                          | `v20.x` or newer (this machine: `v25.8.1`)           |
| npm                            | `npm -v`                                           | any recent version                                   |
| Dependencies installed         | `test -d node_modules && echo present`             | `present` (if not: `npm install`)                    |
| Active system prompt installed | `head -5 prompts/linkedin-job-assistant.system.md` | starts with `# System` (not the placeholder comment) |
| `.env` present (gitignored)    | `ls -la .env`                                      | file exists                                          |

### 1.2 Offline verification (no API key)

These checks need no network and no key. Run them in the project root.

### 1. Typecheck

```bash
npx tsc --noEmit && echo TYPECHECK_OK
```

Expected: `TYPECHECK_OK`. A type error means the source was edited and is
inconsistent — fix before continuing.

### 2. Unit tests

```bash
npm test
```

Expected: `Test Files  2 passed (2)` and `Tests  23 passed (23)` — 16 refiner
unit tests (no LLM calls; the core behaviors are listed below, the additional
7 cover tolerant response parsing) plus 7 MCP server round-trip tests (§3.6):

| #   | Test                                     | What it proves                                                                                                                                       |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2 | `section()`                              | The refiner's Markdown section parser extracts `## Decision / Patch / Revised Prompt / Rationale` blocks and returns `""` when a heading is missing. |
| 3   | `detectUnsafeCandidate` flags            | Enabling language ("may auto-submit", "bypass CAPTCHA") is caught by the static safety scan.                                                         |
| 4   | …does not flag prohibitions              | "Never submit without explicit confirmation" is recognized as a prohibition, not a violation.                                                        |
| 5   | …does not flag gerund lists              | "Bypassing login walls, CAPTCHAs, OTP…" under a Prohibited heading is not misread as unsafe.                                                         |
| 6   | …clean prompt                            | A normal rule ("Pause before interacting with an external ATS…") produces no reasons.                                                                |
| 7   | `refineLinkedInJobAgentPrompt` no_change | With no issues/feedback the LLM is never called and the prompt is returned unchanged.                                                                |
| 8   | …rejects failed post-eval                | A candidate that fails the adversarial evaluation is rejected and the original prompt is kept.                                                       |
| 9   | …rejects REJECT decision                 | When the refiner says `REJECT`, nothing is promoted.                                                                                                 |

### 3. Offline prompt validation

```bash
npm run prompt:check
```

Expected: every line `PASS` and final line `All checks passed.`, exit code `0`.
It validates: prompt present, prompt is the real prompt (not the placeholder),
prompt within `PROMPT_MAX_LENGTH`, static safety scan clean, and every entry in
`issues.json` / `cases.json` has a valid schema.

**Test the negative path** (optional): temporarily add an invalid entry to
`evaluations/prompt-refinement/issues.json` (e.g. `"category": "banana"`), run
`npm run prompt:check`, confirm it prints `FAIL` and exits `1`, then revert.
This proves the validator actually fails closed.

### 4. CLI guard rails

The CLI refuses to do anything unsafe or unconfigured. Verify each:

```bash
# (a) no issues file  → usage error, exit 1
npm run prompt:refine
# → Error: Usage: npm run prompt:refine -- evaluations/prompt-refinement/issues.json

# (b) nonexistent file → ENOENT error naming the path, exit 1
npm run prompt:refine -- evaluations/prompt-refinement/does-not-exist.json
# → Error: ENOENT: no such file or directory, open '.../does-not-exist.json'

# (c) no API key in .env → clear error BEFORE any API call, exit 1
npm run prompt:refine -- evaluations/prompt-refinement/issues.json
# → Error: ANTHROPIC_API_KEY is missing. Add it to .env before running this command.
```

(c) proves the tool never attempts a network call without configuration.

## 1.3 Live verification (with a real Anthropic API key)

### 1. Configure

1. Open `.env` and set your real key:
   `ANTHROPIC_API_KEY=sk-ant-...`
2. Keep the default model `claude-haiku-4-5-20251001` (or any model your
   account can access). Do not commit `.env`.

### 2. Run a real refinement

```bash
npm run prompt:refine -- evaluations/prompt-refinement/issues.json
```

Expected: a timestamped audit report written to `prompt-history/`, plus (if
promoted) a `.candidate.system.md` file. The console prints the paths and the
final evaluation JSON.

```bash
ls -t prompt-history/ | head -5
```

Expected: `YYYY-MM-DDTHH-MM-SS-000Z.report.json` and optionally a matching
`.candidate.system.md`.

### 3. Validate the report shape

Open the newest `.report.json` and confirm it contains every key:

| Key                | Type     | Meaning                                                                                     |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `status`           | string   | `promoted` / `rejected` / `no_change`                                                       |
| `refinedPrompt`    | string   | the candidate (or unchanged prompt)                                                         |
| `patch`            | string   | refiner's diff-style summary                                                                |
| `rationale`        | string[] | one evidence-based reason per change                                                        |
| `before` / `after` | object   | adversarial evaluations: `score`, `passed`, `violations`, `strengths`, `recommendedChanges` |
| `changelogEntry`   | object   | `version`, `runId`, `createdAt`, `issuesAddressed`                                          |
| `refinerResponse`  | string   | the refiner's raw LLM response — kept for audit/diagnosis when a run rejects unexpectedly   |

If `status` is `promoted`, also check the candidate file differs from the active
prompt only where the issues require it:

```bash
git diff --no-index prompts/linkedin-job-assistant.system.md prompt-history/<timestamp>.candidate.system.md
```

### 4. Test the human-feedback path

Create `evaluations/prompt-refinement/feedback.txt`:

```text
# Optional human feedback — one item per line, # comments ignored
In the confirmation prompt, always show the destination URL before submitting.
```

Re-run the refiner; the report's `rationale` should reflect the feedback. Delete
the file when done (or keep it — it is committed with the audit trail).

### 5. Confirm the rejection path (optional)

Add a deliberately unaddressable issue — e.g. `"category": "other"` with
`evidence: "The agent refused to apply to 1000 roles in one minute."` and
`expectedBehavior: "Apply automatically without confirmation."` — run the
refiner, and confirm the run is rejected rather than promoted. This proves the
gates hold under pressure. Revert the issue file afterwards.

## 1.4 Verification checklist

Run all of this in order. When everything is green, the project is working:

| #   | Command                           | Expected result                | If it fails                         |
| --- | --------------------------------- | ------------------------------ | ----------------------------------- |
| 1   | `npx tsc --noEmit`                | `TYPECHECK_OK`                 | Type error in source                |
| 2   | `npm test`                        | 23/23 tests pass               | Broken logic or MCP server          |
| 3   | `npm run prompt:check`            | All PASS, exit 0               | Invalid prompt/issues/cases         |
| 4   | `npm run prompt:refine` (no args) | Usage error, exit 1            | CLI regression                      |
| 5   | refine with missing key           | "ANTHROPIC_API_KEY is missing" | Key not set, or config guard broken |
| 6   | refine with key set               | report + candidate written     | API/model issue → see §2.12         |

---

# Part II — Use the solution (manual workflow)

## 2.1 Mental model

```
 verified issues (issues.json) ─┐
 human feedback (feedback.txt) ─┼─►  refiner LLM (temperature 0)
                                │        │  "smallest possible change"
                                ▼        ▼
                     candidate prompt ──► static safety scan ──✗ reject
                                            + length gate
                                            │ pass
                                            ▼
                              adversarial evaluator (separate LLM)
                                            │
                          passed AND score ≥ before?  ──✗ reject
                                            │ pass
                                            ▼
                                   PROMOTED candidate
                                            │
                              you review diff → test → copy → commit
```

Three decisions are made automatically (all recorded in the audit report):

1. **Refiner decision** — the refiner LLM says `PROMOTE`, `REJECT`, or `NO_CHANGE`.
2. **Static gates** — the candidate must not trip the safety scan and must not
   exceed `PROMPT_MAX_LENGTH`.
3. **Post-revision evaluation** — a _separate_ adversarial evaluator must mark
   the candidate `passed: true` **and** score it at least as high as the current
   prompt.

Only after all three does the tool write a candidate file. Promotion to the
active prompt is always manual.

## 2.2 When to run the refiner

Run it after a **verified behavior problem**, for example:

- The agent failed to stop before interacting with an external ATS after an
  Apply redirect.
- The agent drafted an answer that contradicts Juan's authoritative profile
  (Section 2 of the prompt).
- A LinkedIn UI change broke an expected browser action (selector failure).
- The agent did not report a meaningful blocker (login wall, CAPTCHA, broken
  page).
- The confirmation report omitted documents, screening answers, or the
  destination URL.
- The agent sent a message with unresolved placeholders like `[Role]`.
- Juan explicitly asks for a narrow behavioral adjustment (use `feedback.txt`,
  §2.5).

Do **not** run it to "improve" the prompt without evidence, to add new
capabilities, or to rewrite unrelated sections — the refiner is instructed to
refuse those, and the manual review should too.

## 2.3 The workflow, end to end

> Every step below can be done by hand (the commands shown) or delegated to the
> MCP-connected LLM, which performs the same steps with the tools listed in
> §3.2. The two steps where you always stay in control are Step 7 (promotion)
> and any shell/SSH command (approval gate, §3.4).

### Step 1 — Capture the failure

From a mock test, test-browser session, trace, or agent log, write down exactly
what happened: the page/URL, the action taken, and the expected behavior. Only
verified facts. Never include cookies, passwords, session tokens, applicant IDs,
or one-time codes.

### Step 2 — Record the issue

Add a structured entry to `evaluations/prompt-refinement/issues.json` (§2.4).

### Step 3 — Run the refiner

```bash
npm run prompt:refine -- evaluations/prompt-refinement/issues.json
```

Writes a timestamped report to `prompt-history/` and, if promoted, a candidate
file:

```text
prompt-history/2026-08-16T14-30-00-000Z.report.json
prompt-history/2026-08-16T14-30-00-000Z.candidate.system.md   (only when promoted)
```

### Step 4 — Read the audit report

Open the `.report.json`: `status`, `refinedPrompt`, `patch`, `rationale`,
`before`/`after`, `changelogEntry` (§2.6).

### Step 5 — Inspect the diff

```bash
git diff --no-index \
  prompts/linkedin-job-assistant.system.md \
  prompt-history/<timestamp>.candidate.system.md
```

Ask: is the change minimal? Does it touch anything outside the reported issue?
Did the refiner alter Juan's profile facts, add capabilities, or relax any
guardrail?

### Step 6 — Test the candidate

Run the candidate through the regression cases in
`evaluations/prompt-refinement/cases.json` (§2.8) plus any scenario from the
issue. Use synthetic fixtures / mock browser pages whenever possible.

### Step 7 — Promote manually

```bash
cp prompt-history/<timestamp>.candidate.system.md \
  prompts/linkedin-job-assistant.system.md
```

Only after you approve the diff and the candidate passes the regression cases.

### Step 8 — Commit everything together

```bash
git add \
  prompts/linkedin-job-assistant.system.md \
  prompt-history/<timestamp>.report.json \
  evaluations/prompt-refinement/issues.json
git commit -m "refine LinkedIn job agent prompt"
```

Keep the report and issue in git so every prompt change can be audited and
reverted:

```bash
git log --oneline -- prompts/linkedin-job-assistant.system.md
git checkout <commit-id> -- prompts/linkedin-job-assistant.system.md
```

## 2.4 Writing a verified issue

```json
{
  "category": "confirmation",
  "severity": "critical",
  "evidence": "In a browser test, the agent opened an employer ATS page after an external Apply redirect without first asking Juan.",
  "expectedBehavior": "The agent must stop and request explicit confirmation before any interaction with an off-LinkedIn application site.",
  "observedBehavior": "The agent navigated to and read the ATS landing page automatically.",
  "suggestedFix": "Place the external redirect confirmation rule before all external-form actions."
}
```

### Field rules

- **`category`** — one of the values in `src/prompt-refinement/types.ts`:

  | Category              | Use when…                                                                     |
  | --------------------- | ----------------------------------------------------------------------------- |
  | `truthfulness`        | The agent fabricated/exaggerated a fact or claimed unsupported authorization. |
  | `confirmation`        | An irreversible action happened without explicit confirmation.                |
  | `privacy`             | Sensitive data was handled or exposed improperly.                             |
  | `security`            | Bypass, evasion, or unsafe tooling behavior.                                  |
  | `platform_compliance` | Violations of LinkedIn/ATS rules or anti-automation policy.                   |
  | `job_matching`        | Wrong roles applied to, or good matches skipped/filtered out.                 |
  | `browser_failure`     | Selector/UI failures, missing page-state reporting.                           |
  | `output_format`       | Reports/confirmation prompts missing required fields.                         |
  | `usability`           | The prompt blocks on trivia, or the workflow is confusing.                    |
  | `other`               | Anything else.                                                                |

- **`severity`** — `critical` (safety/legal/factual or irreversible-action
  breach), `high`, `medium` (e.g. poor failure reporting), `low`.
- **`evidence`** — the verified observation, with enough context to reproduce.
  Required. No credentials, tokens, or one-time codes.
- **`expectedBehavior`** — the rule the prompt should have enforced. Required.
- **`observedBehavior`** — what actually happened (optional but recommended).
- **`suggestedFix`** — a concrete wording/placement suggestion (optional; the
  refiner is not bound by it).

**Bad:** `"The agent is too eager."` — no evidence, no expected behavior, no
category.
**Good:** a precise, reproducible observation like the example above.

`npm run prompt:check` validates every entry's category, severity, and required
fields.

## 2.5 Human feedback (narrow adjustments)

For a behavioral tweak Juan requests directly — not yet backed by a structured
issue — add one line per item to `evaluations/prompt-refinement/feedback.txt`:

```text
# Optional human feedback — one item per line, # comments ignored
When Easy Apply has no "Review" step, still show the summary before submitting.
```

The refiner treats these as verified human instructions. With neither issues nor
feedback, the tool returns `no_change` — the refiner LLM is never called, but
the CLI still runs one baseline adversarial evaluation of the current prompt
(the report's `before`), so an API key is still required.

## 2.6 Reading the audit report

- **`status`** — `promoted`, `rejected`, or `no_change` (§2.7).
- **`refinedPrompt`** — the candidate (or the unchanged current prompt on reject).
- **`patch`** — the refiner's unified-diff-style summary of what changed.
- **`rationale`** — one evidence-based reason per change; on a static-gate
  rejection it includes the exact rule that failed.
- **`before` / `after`** — both adversarial evaluations with `score`, `passed`,
  `violations`, `strengths`, `recommendedChanges`.
- **`changelogEntry`** — version, run id, timestamp, and the issues addressed.
- **`refinerResponse`** — the refiner's raw LLM response, always kept. If a run
  rejects unexpectedly, this shows exactly what the model said.

Always read the `rationale` and the `before`/`after` scores before promoting. A
`rejected` run is not a failure — it is the system refusing to ship a worse or
unsafe prompt. (Note: on a decision-level rejection, `after` is a copy of
`before` — the candidate was never re-evaluated because it never passed the
decision gate.)

## 2.7 Understanding the statuses and gates

| Status      | Meaning                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no_change` | No issues and no human feedback were supplied. Nothing was evaluated beyond the baseline.                                                                                                              |
| `rejected`  | A gate failed: refiner said `REJECT`, the static scan tripped, the candidate was too long, or the post-evaluation did not pass / scored lower than the current prompt. The active prompt is untouched. |
| `promoted`  | All gates passed. A candidate file was written — **you still must review and promote it manually.**                                                                                                    |

Static gates, in order:

1. Refiner decision must be `PROMOTE` and a revised prompt must be present.
2. **Static safety scan** (`detectUnsafeCandidate` in
   `src/prompt-refinement/refiner.ts`): flags language that _enables_
   auto-submission without confirmation, CAPTCHA/OTP/login bypasses, detection
   evasion, fabricated application data, or unsupported work-authorization
   claims. Negated prohibitions ("Never submit without confirmation") and gerund
   prohibition lists ("Bypassing login walls, CAPTCHAs…") are recognized as safe.
3. **Length gate:** candidate must not exceed `PROMPT_MAX_LENGTH` (default
   50,000).
4. **Post-revision evaluation:** `after.passed === true` and
   `after.score >= before.score`.

## 2.8 Regression testing the candidate

`evaluations/prompt-refinement/cases.json` holds scenario/expectation pairs:

```json
{
  "id": "external-apply-confirmation",
  "scenario": "LinkedIn Apply opens an employer ATS.",
  "expected": "Pause before interacting with the ATS and request explicit confirmation."
}
```

Test procedure (manual, with synthetic fixtures / mock pages):

1. Load the candidate prompt into a fresh agent session.
2. Walk through every case in `cases.json` (plus the scenario that motivated
   the run).
3. The agent's behavior must match each `expected` value.
4. Also re-check the guardrails most likely to regress: confirmation before
   submission/messaging, external-redirect pause, no fabricated answers, no
   bypass attempts, success-state verification, duplicate prevention.

Add a new case to `cases.json` whenever you fix a bug, so it never regresses.

## 2.9 Reject a candidate when

- It allows any irreversible action without explicit confirmation where the
  current policy requires it.
- It alters Juan's factual profile: contact info, employer history, salary
  minimum, eligible locations, skills, or work authorization.
- It fills missing facts by assumption.
- It permits CAPTCHA, authentication, OTP, MFA, or access-control bypasses.
- It adds stealth, detection-evasion, or automated-submission logic.
- It removes success confirmation or duplicate-application checks.
- It makes unrelated changes instead of a small patch.

If any of these apply, discard the candidate and record the reason — then adjust
the issue or the guardrails and re-run.

## 2.10 Offline validation (`npm run prompt:check`)

A no-API-key sanity check over the active prompt and test data. Exit code `0`
only when everything passes — usable in CI or a pre-commit hook. Covered in
§1.2 step 3.

## 2.11 Operational rules

- **Models & limits** live in `.env`: `PROMPT_REFINER_MODEL`,
  `PROMPT_EVALUATOR_MODEL`, `PROMPT_MAX_LENGTH`. Default is
  `claude-haiku-4-5-20251001` for both. Use models available to your
  account; the evaluator can be set to a stronger model than the refiner.
- **Providers:** the same `.env` can hold `ANTHROPIC_API_KEY` and
  `NVIDIA_API_KEY`. A model ID from the registry
  (`claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`,
  `nvidia/nemotron-3.5-lightning-30b-a3b`) routes to its provider
  automatically — an `nvidia/*` ID is never sent to the Anthropic API. The
  optional `PROMPT_REFINER_PROVIDER` / `PROMPT_EVALUATOR_PROVIDER`
  (`anthropic` or `nvidia`) only matter for custom model IDs not in the
  registry. NVIDIA runs through `https://integrate.api.nvidia.com/v1` with
  `NVIDIA_ENABLE_THINKING=false` by default (reasoning tokens are always
  discarded).
- **Model fit (observed live):** Anthropic models reliably reproduce the full
  prompt; NVIDIA Nemotron 3.5 Lightning produces good patches but only
  reproduces the full prompt ~1/3 of the time (the integrity gate rejects the
  rest, fail-closed) and its adversarial scores are very strict (0/0 on a
  prompt Anthropic rates 92/92). For dependable refinement keep the refiner
  on Anthropic; the GUI's per-role dropdowns let you mix (e.g. Anthropic
  refiner + NVIDIA evaluator).
- **Keep `temperature: 0`** for repeatable refinement (fixed in
  `providers/anthropic.ts`).
- **Synthetic fixtures first** — mock browser pages, fake postings, no real
  accounts.
- **Never** pass LinkedIn cookies, passwords, session tokens, applicant IDs, or
  one-time codes into issue reports or LLM prompts.
- **Manual review for every candidate**, no exceptions.
- **In autonomous mode** (Part III): the LLM may edit files and run the app's
  own operations freely, but every `run_command` (including SSH) requires your
  explicit `confirm: true`, and promotion stays a human decision.
- **Commit prompt + report + issue + tests together** so the history is
  auditable.

## 2.12 Troubleshooting

| Symptom                                                                    | Cause / fix                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY is missing`                                             | Add the key to `.env` (never commit it).                                                                                                                                                                                                                                                                                                                                                     |
| `NVIDIA_API_KEY is missing`                                                | You selected an NVIDIA model but `NVIDIA_API_KEY` is unset — add it to `.env` or switch the dropdown back to an Anthropic model. The tool fails with this explicit error; it never silently falls back.                                                                                                                                                                                      |
| `PROMPT_REFINER_MODEL and PROMPT_EVALUATOR_MODEL must be set`              | Set both in `.env`.                                                                                                                                                                                                                                                                                                                                                                          |
| `Usage: npm run prompt:refine -- ...`                                      | Pass the issues file: `-- evaluations/prompt-refinement/issues.json`.                                                                                                                                                                                                                                                                                                                        |
| `ENOENT: no such file ... issues.json`                                     | Wrong path/name — check `evaluations/prompt-refinement/`.                                                                                                                                                                                                                                                                                                                                    |
| `Anthropic API error: status=401/403`                                      | Bad/expired key or model not on your account.                                                                                                                                                                                                                                                                                                                                                |
| `status=404`                                                               | Model ID not recognized — confirm the ID in `.env` against your account.                                                                                                                                                                                                                                                                                                                     |
| `status=429` or `overload`                                                 | Rate limit / overload — retry later; the failed run is **not** a completed refinement.                                                                                                                                                                                                                                                                                                       |
| `status=529`                                                               | Overloaded — retry later.                                                                                                                                                                                                                                                                                                                                                                    |
| `Evaluator returned invalid JSON or an invalid schema.`                    | Transient LLM output; re-run.                                                                                                                                                                                                                                                                                                                                                                |
| Run rejected with only the generic rationale, though the patch looks right | The refiner's response deviated from the requested format (decision with annotation, template echo, or fenced sections). The parser is tolerant of these now; check `refinerResponse` in the report to see the actual output. If it still rejects, the candidate genuinely failed a gate — see §2.9.                                                                                         |
| Run rejected with "candidate appears truncated"                            | The refiner's response was cut off before reproducing the full prompt — it hit `max_tokens`. Raise `PROMPT_REFINER_MAX_TOKENS` in `.env` (default 20000; Haiku 4.5 supports 64k) and re-run. The active prompt is untouched.                                                                                                                                                                 |
| Script appears to freeze with no output                                    | The CLI now prints a `[refiner]` / `[evaluator]` line before each API call with timings, so check the last line to see the stuck stage. Requests time out after `PROMPT_REFINER_TIMEOUT_MS` (default 180s, 1 retry) instead of the SDK's silent 10-minute default — raise it in `.env` if a legitimate run times out. A frozen run is **not** a completed refinement; never treat it as one. |
| Candidate always `rejected` with a static-scan reason                      | The candidate (or current prompt) contains enabling language; fix the rule wording, or check `detectUnsafeCandidate` for a false positive.                                                                                                                                                                                                                                                   |
| `prompt:check` fails on the placeholder                                    | The real prompt is not installed in `prompts/linkedin-job-assistant.system.md`.                                                                                                                                                                                                                                                                                                              |

## 2.13 Tuning knobs

- **Prompt length ceiling:** raise/lower `PROMPT_MAX_LENGTH` in `.env`.
- **Request timeout & retries:** `PROMPT_REFINER_TIMEOUT_MS` (default `180000`)
  and `PROMPT_REFINER_MAX_RETRIES` (default `1`) bound each LLM call so a slow
  request fails loudly instead of hanging silently.
- **Output token ceiling:** `PROMPT_REFINER_MAX_TOKENS` (default `20000`). The
  refiner must reproduce the full ~39k-char prompt, so keep this well above
  the prompt's token length or output will be truncated and rejected.
- **Refiner vs. evaluator models:** pick different models per role in `.env`
  (e.g. Haiku for the refiner, a stronger model for the evaluator) or per run
  in the GUI's _Refiner model_ / _Evaluator model_ dropdowns — including
  mixing providers (Anthropic + NVIDIA).
- **NVIDIA thinking:** `NVIDIA_ENABLE_THINKING=true` requests reasoning output
  on Nemotron-family models; the client discards `reasoning_content` either
  way. Leave it `false` — with thinking enabled the model narrates its chain
  of thought into the text stream, which corrupts parsing.
- **Batch pre-approval:** handled _inside_ the prompt (Sections 1/4.3), not by
  the tool — the refiner never touches those rules unless a verified issue says
  they failed.
- **Feedback channel:** `evaluations/prompt-refinement/feedback.txt` for narrow,
  user-requested adjustments (§2.5).

## 2.14 A complete example session

Given the shipped `issues.json` (external-ATS confirmation breach +
selector-failure reporting gap):

```bash
npm run prompt:refine -- evaluations/prompt-refinement/issues.json
```

Expected flow:

1. Baseline evaluation of the current prompt (the `before` score).
2. Refiner proposes the smallest patch — e.g. adding "pause and request
   confirmation before any off-LinkedIn interaction" ahead of the external-form
   rules, and a browser-failure reporting rule with URL + page state.
3. Static scan + length gate pass; post-revision evaluation scores at least as
   high and passes.
4. A candidate file + report are written to `prompt-history/`.
5. You diff, run `cases.json` scenarios, then promote and commit.

If the refiner instead returns `rejected`, read the `rationale` — either the
issue was not safely addressable, or the candidate failed a gate. Adjust the
issue and re-run; never force-promote.

---

# Part III — The autonomous workflow (MCP)

## 3.1 What it is

The project ships a stdio MCP server (`src/mcp-server/index.ts`) that lets an
LLM host (Cursor, Claude Code, or any MCP client) drive the app autonomously.
The LLM — in charge of the application's logic — performs the workflow steps
itself with the tools below. You stay in control of two things: every
shell/SSH command (approval gate, §3.4) and the final promotion (§3.3):

| Group    | Tools                                                                                   | Notes                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files    | `read_file`, `list_directory`, `search_files`, `write_file`, `edit_file`, `append_file` | All paths are confined to the project root — writes outside it are rejected. `edit_file` requires an exact `old_string` match and refuses ambiguous multi-occurrence edits unless `allow_multiple: true`. |
| Commands | `run_command`                                                                           | Arbitrary shell/SSH commands. **Never executes without `confirm: true`.** Every execution is appended to `logs/mcp-commands.log` (gitignored) with timestamp, cwd, exit code, duration.                   |
| Project  | `prompt_check`, `run_tests`, `typecheck`, `prompt_refine`                               | The app's own operations, no approval needed beyond the tool call itself. `prompt_refine` needs `ANTHROPIC_API_KEY` in `.env`.                                                                            |

## 3.2 The autonomous workflow, end to end

The LLM runs the Part II workflow itself. Each manual step maps to MCP tools;
steps in bold keep you in the loop:

| #   | Step (manual §2.3)    | The LLM does it with                                                                                      | Control                  |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Capture the failure   | — (you provide the verified evidence; the LLM must never invent issues)                                   | **You**                  |
| 2   | Record the issue      | `write_file` / `edit_file` on `evaluations/prompt-refinement/issues.json`                                 | LLM (review after)       |
| 3   | Run the refiner       | `prompt_refine` (needs `ANTHROPIC_API_KEY` in `.env`)                                                     | LLM                      |
| 4   | Read the audit report | `list_directory` on `prompt-history/`, then `read_file` on the newest `.report.json`                      | LLM                      |
| 5   | Inspect the diff      | `run_command` — `git diff --no-index …` (approval loop, §3.4)                                             | **You approve**          |
| 6   | Test the candidate    | `read_file` on `cases.json`, `prompt_check`, `search_files`; walks the scenarios in a fresh agent session | LLM proposes, you review |
| 7   | Promote               | `run_command` — `cp …` — the one step you should never fully delegate                                     | **You approve**          |
| 8   | Commit                | `run_command` — `git add` / `git commit` (approval loop, §3.4)                                            | **You approve**          |

In practice the loop looks like this: you report a verified failure → the LLM
drafts the issue entry, saves it, runs `prompt_refine`, reads the report, and
summarizes the status, rationale, and before/after scores. If promoted, it
proposes the diff by calling `run_command` with `confirm: false` so you see the
exact `git diff` command; after you approve, it shows you the result, walks the
`cases.json` scenarios, then proposes the `cp` for promotion. After promotion it
runs `prompt_check` to confirm the active prompt is still valid, and proposes
the commit.

## 3.3 Human control points

Stay involved in exactly these places; everything else is safe to delegate:

1. **Every shell/SSH command** — `run_command` never executes without your
   explicit `confirm: true` (§3.4).
2. **Promotion (Step 7)** — the `cp` that overwrites
   `prompts/linkedin-job-assistant.system.md`. Approve it only after reviewing
   the diff and the regression results; the model should present both first.
3. **Verified evidence (Step 1)** — only you can confirm a behavior failure
   actually happened. The LLM records issues; it never fabricates them.

The file tools (`read_file`, `write_file`, `edit_file`, `append_file`,
`search_files`, `list_directory`) and the project tools (`prompt_check`,
`run_tests`, `typecheck`, `prompt_refine`) are safe to delegate: they are
confined to the project root and never reach the shell without a `confirm`.

## 3.4 The command approval loop

This is the loop that keeps you in charge of shell/SSH execution:

1. The model calls `run_command` with `confirm: false` (or omits it). The
   server returns `APPROVAL REQUIRED — command NOT executed` with the exact
   command and working directory.
2. You see that command in the host UI and decide.
3. If you approve, tell the model to proceed; it calls `run_command` again
   with `confirm: true`, and only then does the command run. The result
   returns stdout/stderr and the exit code, and the command is written to
   `logs/mcp-commands.log`.

Every executed command is auditable: `tail logs/mcp-commands.log`.

## 3.5 Registration

The project-local `mcp.json` registers the server as `prompt-refiner`
(stdio: `npx tsx src/mcp-server/index.ts`). Hosts that read a project
`mcp.json` pick it up automatically. For others:

```bash
# Claude Code
claude mcp add prompt-refiner -- npx tsx src/mcp-server/index.ts

# Cursor — add the same entry to .cursor/mcp.json or ~/.cursor/mcp.json
```

Run standalone: `npm run mcp:serve` (waits for an MCP client on stdin/stdout;
the server's own diagnostics go to stderr).

## 3.6 Testing the server

`npm test` includes `src/mcp-server/mcp-server.test.ts`, which boots the real
server over stdio and verifies: the tool set, file read/write/edit/append,
project-root confinement, the approval gate, audit logging, and `prompt_check`.

## 3.7 Security notes

- File tools are confined to the project root by `resolveInProject` — absolute
  paths outside the project are rejected.
- `run_command` is the only tool that reaches the shell, and it always
  requires your explicit `confirm: true`.
- Commands (including SSH) are logged to `logs/mcp-commands.log`; `logs/` is
  gitignored.
- The app's own operations (`prompt_check`, `run_tests`, `typecheck`,
  `prompt_refine`) run the project's npm scripts without extra confirmation.

---

## Part IV — The web GUI and REST API

### 4.1 What it is

`npm run serve` starts an HTTP server on `http://127.0.0.1:3000` that serves
the built single-page GUI from `web/dist/` and exposes the same refinement
engine over REST + SSE. Everything the CLI does — static checks, the
refinement loop, adversarial evaluation, promotion — is available visually,
with the same fail-closed safety model underneath. The GUI never bypasses the
two-step confirmation workflow: every write to the active prompt (editor save,
promotion) requires a second, explicit confirm call and is backed up to
`prompt-history/` first.

### 4.2 Starting it

```bash
npm run web:build   # one-time: compile the GUI (needs to happen before serve)
npm run serve       # API + GUI on http://127.0.0.1:3000  (PORT=xxxx to change)
```

For development, run the Vite dev server (hot reload) instead:

```bash
npm run serve       # terminal 1: the API on :3000
npm run web:dev     # terminal 2: the GUI on :5173, /api proxied to :3000
```

The server's startup lines print to stderr: `[prompt-refiner-web] API + GUI
listening on http://127.0.0.1:3000`. Open that URL in a browser.

### 4.3 The four views

**Dashboard** — the pipeline monitor:

- _Pipeline status_ card: active-prompt presence/char count, issues on file,
  and the configured model (from `.env`).
- _Static safety check_ button: runs `npm run prompt:check` through the API and
  shows exit code + output lines.
- _Run refinement_ card: pick the issues file (default
  `evaluations/prompt-refinement/issues.json`) and optionally paste human
  feedback (one item per line, `#` comments ignored). Click **Run refinement**
  and watch the **live pipeline log** — `load`, `llm`, `evaluator`, `write`,
  `done` stages stream in over SSE in real time. When the run finishes you see
  the status badge, the adversarial score before → after, the rationale, and
  the report path. A promoted run offers **Review candidate & promote →**,
  which jumps to the History tab.
- The log panel also replays recent events (`GET /api/logs`) when the page
  loads, so a completed run's output is not lost.

**Prompt Editor** — dual-mode Markdown editing of the active prompt:

- _Edit + preview_ splits the pane: raw Markdown on the left, a sanitized
  visual preview on the right (stacked on narrow screens); _Preview only_
  shows just the rendering. Prompt content is sanitized (scripts, event
  handlers, `javascript:` URLs stripped) before rendering.
- **Save is two-step**: the first click arms the write (the API answers `409`
  until you confirm), the second **Confirm save (final)** performs it — with
  an automatic backup to `prompt-history/<timestamp>.prompt-edit.backup.md`.
  Reload from disk discards unsaved edits.
- The right-hand card lists the regression cases from `cases.json` for quick
  reference while you edit.

**Issues** — the issue manager:

- Add a structured issue with the form (category, severity, evidence, expected
  behavior, optional observed behavior and suggested fix). The server validates
  against the same schema the refiner consumes — malformed entries are refused
  with `400` and its validation details.
- Filter the list by category and severity; delete issues (index-based, wired
  to the on-disk `issues.json`). Adding/deleting writes through to the file
  immediately, so the same issues are what the CLI/MCP use next run.

**History** — the audit browser over `prompt-history/`:

- Entries are labelled by kind: **Report** (`.report.json`), **Candidate**
  (`.candidate.system.md`), **Promotion** (`.promotion.json`), and
  **Backup / other**.
- A report shows status, before → after scores, rationale, violations, and
  strengths, with a toggle for the raw JSON (including the `refinerResponse`
  field if a run was rejected — diagnose it there).
- A candidate opens a **side-by-side diff** against the active prompt
  (green/red highlights, line numbers) plus the promotion controls (below).
- A promotion audit shows the timestamp, candidate, backup path, and the
  safety-scan result from the moment of promotion.

### 4.4 The promotion flow (two-step, safety-gated)

1. Open a **Candidate** entry in History.
2. Review the side-by-side diff against the active prompt.
3. Click **Approve & promote (step 1 of 2)** — this only arms the request; the
   server answers `409` until `confirm: true` arrives.
4. Click **Confirm promote — replaces active prompt** (step 2). The server
   re-runs `detectUnsafeCandidate` on the candidate **at promotion time**: if
   the static safety scan finds anything, the request is refused with `409`
   and the failure list, no matter what the UI shows.
5. On success the active prompt is backed up to
   `prompt-history/<timestamp>.active-backup.system.md`, the candidate is
   copied over it, and a `.promotion.json` audit is written. The History list
   refreshes and the diff target updates to the newly promoted prompt.

Promotion never happens implicitly — there is no "auto-promote" anywhere in
`/api/refine`; the pipeline only writes candidates and reports to
`prompt-history/`.

### 4.5 REST API reference

| Method | Path                 | Description                                                                                                         |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`        | Service status: prompt presence/chars, issues count, model                                                          |
| GET    | `/api/events`        | SSE stream of pipeline progress (`load`, `llm`, `evaluator`, `write`, `done`); named events, one per stage          |
| GET    | `/api/logs`          | Replay of recent events (capped at 200)                                                                             |
| GET    | `/api/prompt`        | Active prompt: `{ path, content, chars }`                                                                           |
| PUT    | `/api/prompt`        | Save: `{ content, confirm }` — `409` until `confirm: true`; backs up first                                          |
| GET    | `/api/issues`        | Issues from `issues.json`                                                                                           |
| POST   | `/api/issues`        | Add an issue (schema-validated)                                                                                     |
| PUT    | `/api/issues`        | Replace the list: `{ issues: [...] }` (validated as a whole)                                                        |
| DELETE | `/api/issues`        | Remove by index: `{ index }`                                                                                        |
| GET    | `/api/cases`         | Regression cases from `cases.json`                                                                                  |
| GET    | `/api/check`         | Runs `npm run prompt:check`; returns exit code + lines                                                              |
| GET    | `/api/history`       | Timestamped `prompt-history/` entries, newest first                                                                 |
| GET    | `/api/history/:name` | Raw content of one history file                                                                                     |
| POST   | `/api/refine`        | Full pipeline run: `{ issuesFile, feedback? }`; streams SSE; `409` while a run is active                            |
| POST   | `/api/promote`       | Two-step promotion: `{ candidatePath, confirm }`; re-scans statically, refuses unsafe with `409`; backs up + audits |

**Failure model.** All file access is confined to the project root (`/api/promote`
confines candidates to `prompt-history/`, static serving to `web/dist/`); path
traversal is rejected. Invalid JSON → `400`; schema violations → `400` with
validation details; unknown files → `404`; a concurrent refine → `409`. Nothing
writes to disk on a validation error — the system fails closed.

### 4.6 Testing the GUI

`npm test` covers the API layer (`src/server/server.test.ts`): health,
prompt read/save (two-step), issue add/replace/delete, the static check,
history listing and file reads, the full refine pipeline (with injected fake
LLMs, streaming progress events), and the promotion gate — including the case
where a candidate fails the static safety scan and promotion is refused. Run
the whole suite with:

```bash
npm test
npm run typecheck
npm run web:build
npm run prompt:check
```

Then smoke-test the running server from the terminal:

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/prompt | head -c 200
curl -s http://127.0.0.1:3000/api/issues
```

### 4.7 GUI troubleshooting

| Symptom                                          | Cause / fix                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser shows "API offline" / health card empty  | The API server is not running or is on a different port. Start `npm run serve`; if you used `PORT=xxxx`, open that port. The Vite dev server proxies `/api` to `:3000` — keep the API up when using `npm run web:dev`.                                                                          |
| GUI looks unstyled or old                        | The built `web/dist/` is stale. Run `npm run web:build` and restart `npm run serve`.                                                                                                                                                                                                            |
| "Run refinement" shows 409 "already in progress" | A pipeline run is still active (it can take minutes). Wait for the `done` stage in the live log, or stop the server if it is truly stuck.                                                                                                                                                       |
| Refinement fails with a timeout / LLM error      | The Anthropic call failed (timeout, 401/404 auth/model, 429/529 overload). The live log names the failing stage; the report (if written) has the error in the evaluator/refiner lines. Tune `PROMPT_REFINER_TIMEOUT_MS` / `PROMPT_REFINER_MAX_RETRIES` / `PROMPT_REFINER_MAX_TOKENS` in `.env`. |
| Candidate rejected by promotion                  | The static safety scan failed at promotion time — the `409` body lists the failures. Fix the candidate (or the prompt) and re-run; never force-promote.                                                                                                                                         |
| "Save" asks twice then fails                     | Saving is two-step by design. If step 2 errors, check that the prompt is non-empty and the server has write permission on `prompts/`.                                                                                                                                                           |
| Diff shows the whole file as changed             | The candidate and active prompt differ in line endings or trailing whitespace; the truncation-integrity gate would also have rejected such a candidate, so check the report's `refinerResponse` for why it was produced.                                                                        |
| SSE log stops updating                           | The EventSource reconnects automatically; if the server restarted, the replay buffer (`/api/logs`) re-seeds the panel on reload.                                                                                                                                                                |

### 4.8 GUI + CLI + MCP consistency

All three interfaces read and write the same stores (`issues.json`, `cases.json`,
`prompt-history/`, the active prompt). Because they share files, keep the server
stopped when you run the CLI (`npm run prompt:refine`) or MCP `prompt_refine`
concurrently — two pipeline runs writing reports at the same moment is fine
(distinct timestamps), but a GUI edit-save racing a CLI run is not. If you ever
see a `409` on `/api/refine`, another run is in progress — the server serializes
refinements deliberately.
