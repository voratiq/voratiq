# Using Voratiq to build Voratiq

This tutorial will walk you through how to use the Voratiq CLI end-to-end to implement a real task: adding a `--branch` flag to `voratiq run`.

We use Voratiq to build Voratiq, and this is how that looks in practice. The work done here has been merged into the core codebase, which you can see in [PR #35](https://github.com/voratiq/voratiq/pull/35).

At a high level, the Voratiq workflow follows this sequence: `init` → `spec` → `run` → `review` → `apply` → `prune`. Here's what that looked like for this feature.

## Before you start

To start, Voratiq should be installed and in your `$PATH` (`npm install -g voratiq`).

Then, you need a git repo with a clean working tree, and 1 or more authenticated CLI agents. These prerequisites are checked during preflight, and will throw an error if something is off.

## Initialize the workspace (`init`)

`init` bootstraps the workspace by configuring agents, environment, and evals. It detects which agent CLIs are on your `$PATH` and creates the `.voratiq/` directory structure.

Command:

```bash
voratiq init --yes
```

Output:

```
Initializing Voratiq…

Agents configured (claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-5-20251101, gpt-5-codex, gpt-5-1-codex, gpt-5-1-codex-max, gpt-5-1-codex-max-xhigh, gpt-5-1-codex-mini, gpt-5-2, gpt-5-2-xhigh, gpt-5-2-codex, gpt-5-2-codex-xhigh, gemini-3-pro-preview, gemini-2-5-pro, gemini-2-5-flash).
To modify, edit `.voratiq/agents.yaml`.

Environment configured (node).
To modify, edit `.voratiq/environment.yaml`.

Evals configured (format, lint, typecheck, tests).
To modify, edit `.voratiq/evals.yaml`.

Sandbox configured.
To modify, edit `.voratiq/sandbox.yaml`.

Voratiq initialized.

To begin a run:
  voratiq run --spec <path>
```

Check that the agents you want are in `agents.yaml` before continuing. If something's missing, add it now.

## Generate a spec (`spec`)

`spec` takes a human description and uses a sandboxed agent to generate a structured spec file. Without `--yes`, you get an iterative refinement loop where you can provide feedback until satisfied.

Command:

```bash
voratiq spec \
  --description "Add a --branch flag to voratiq run that checks out (or creates) a git branch named after the spec filename before the run starts. Branch name comes from the spec basename without extension (e.g., specs/separate-eval-outcomes.md -> separate-eval-outcomes, specs/foo/bar.md -> bar). If the worktree is dirty, abort before creating any run record. If checkout/create fails, abort fast with the git error. If the branch exists, switch to it; otherwise create from HEAD. Do this as early as possible in the run lifecycle. Do not change CLI output on success. apply --commit remains unchanged and branch-agnostic. Add tests for branch name derivation, branch create vs checkout, dirty worktree fast-fail, and checkout failure." \
  --agent claude-opus-4-5-20251101 \
  --output .voratiq/specs/add-run-branch.md \
  --yes
```

Output:

```
Generating specification...

Spec saved: .voratiq/specs/add-run-branch.md

To begin a run:
  voratiq run --spec .voratiq/specs/add-run-branch.md
```

One note: avoid backticks in `--description` unless you escape them. Bash interprets them as command substitution.

## Run your agents (`run`)

`run` executes all configured agents in parallel against a spec. Each agent runs in a sandboxed environment. Voratiq captures their outputs, diffs, and summaries, runs any configured evals, and records everything to run history.

Command:

```bash
voratiq run --spec .voratiq/specs/add-run-branch.md
```

Output:

```
20260113-235501-hhkox SUCCEEDED

Created        2026-01-13 15:55 PST
Spec           .voratiq/specs/add-run-branch.md
Workspace      .voratiq/runs/sessions/20260113-235501-hhkox
Base Revision  29163b77

AGENT                       STATUS     ELAPSED  CHANGES     EVALS
claude-haiku-4-5-20251001   SUCCEEDED  4m 58s   5f +381/-2  format lint typecheck tests
claude-sonnet-4-5-20250929  SUCCEEDED  6m 15s   4f +265/-1  format lint typecheck tests
claude-opus-4-5-20251101    SUCCEEDED  5m 6s    4f +265/-1  format lint typecheck tests
gpt-5-codex                 SUCCEEDED  5m 26s   4f +244/-9  format lint typecheck tests
gpt-5-1-codex               SUCCEEDED  5m 40s   4f +261/-1  format lint typecheck tests
gpt-5-1-codex-max           SUCCEEDED  7m 18s   2f +260/-3  format lint typecheck tests
gpt-5-1-codex-max-xhigh     SUCCEEDED  12m 11s  3f +264/-1  format lint typecheck tests
gpt-5-1-codex-mini          SUCCEEDED  6m 9s    4f +235/-1  format lint typecheck tests
gpt-5-2                     SUCCEEDED  7m 5s    6f +236/-2  format lint typecheck tests
gpt-5-2-xhigh               SUCCEEDED  11m 37s  6f +312/-2  format lint typecheck tests
gpt-5-2-codex               SUCCEEDED  5m 50s   2f +175/-1  format lint typecheck tests
gpt-5-2-codex-xhigh         SUCCEEDED  10m 55s  4f +281/-1  format lint typecheck tests

To review results:
  voratiq review --run 20260113-235501-hhkox --agent <agent-id>
```

All 12 agents completed successfully. We use `review` to compare implementations and find the best candidate.

## Review the run (`review`)

`review` launches a sandboxed reviewer agent to analyze artifacts from a completed run and generate a comparison of all agent outputs. The `--agent` flag specifies which agent does the reviewing.

Command:

```bash
voratiq review --run 20260113-235501-hhkox --agent gpt-5-2-codex
```

Output (truncated):

```
Generating review...

# Review of Run 20260113-235501-hhkox

## Specification
**Path**: .voratiq/specs/add-run-branch.md
**Summary**: Add a `--branch` flag to `voratiq run` that derives a branch name from the spec filename and checks out or creates that branch before any run record is created, with clean-worktree gating and tests for derivation/branch behavior/error paths.

[... per-agent sections for all 12 agents, omitted for brevity ...]

## Comparison
The strongest candidates are **claude-opus-4-5-20251101** and **claude-sonnet-4-5-20250929**, both of which pass all evals and implement the feature fully. Opus uses a dedicated preflight module and explicit branch existence checks via `rev-parse`, which is more robust and portable than Sonnet's error-string parsing and path splitting; this makes Opus the safer default. All other agents have failing format/lint/typecheck gates or a spec mismatch (`--branch <name>` in Haiku), so they are not apply-ready.

## Risks / Missing Artifacts
No missing artifacts were detected in `artifact-information.json`; all diffs, summaries, logs, and eval outputs are present.

## Recommendation
**Preferred Agent(s)**: claude-opus-4-5-20251101
**Rationale**: Best spec alignment with clean, centralized preflight logic, robust branch existence detection, clear error propagation, and all evals passing.
**Next Actions**:
voratiq apply --run 20260113-235501-hhkox --agent claude-opus-4-5-20251101

Review saved: .voratiq/reviews/sessions/20260114-000812-rfvvu/gpt-5-2-codex/artifacts/review.md

To integrate a solution:
  voratiq apply --run 20260113-235501-hhkox --agent <agent-id>
```

The agent review is a starting point. We reviewed the top candidates ourselves, and Opus had the best implementation: a dedicated preflight module, proper edge case handling, and focused tests.

## Apply the chosen diff (`apply`)

`apply` takes a specific agent's diff from a recorded run and applies it to your working tree via `git apply`. The `--commit` flag commits with the agent's summary as the message.

Command:

```bash
voratiq apply --run 20260113-235501-hhkox --agent claude-opus-4-5-20251101 --commit
```

Output:

```
20260113-235501-hhkox SUCCEEDED

Created        2026-01-13 15:55 PST
Spec           .voratiq/specs/add-run-branch.md
Workspace      .voratiq/runs/sessions/20260113-235501-hhkox
Base Revision  29163b77

  claude-opus-4-5-20251101 SUCCEEDED

  Duration  5m 6s
  Changes   4 files changed, 265 insertions(+), 1 deletion(-)
  Root      .voratiq/runs/sessions/20260113-235501-hhkox/claude-opus-4-5-20251101

  RUNTIME   PATH
  manifest  runtime/manifest.json
  sandbox   runtime/sandbox.json

  EVAL       STATUS     LOG
  format     SUCCEEDED  evals/format.log
  lint       SUCCEEDED  evals/lint.log
  typecheck  SUCCEEDED  evals/typecheck.log
  tests      SUCCEEDED  evals/tests.log

  ARTIFACT  PATH
  summary   artifacts/summary.txt
  diff      artifacts/diff.patch
  chat      artifacts/chat.jsonl
  stdout    artifacts/stdout.log
  stderr    artifacts/stderr.log

Diff applied to working tree (commit: b8da3e0365a9d2558800bf4d3103cb8a260529ad).

Review the commit (e.g., `git show --stat`) and run tests.
```

The diff is applied and committed. Now we verify it works.

## Validate the result

Command:

```bash
npm run build
npm test
```

Build and tests passed, so we opened a PR.

This was a straightforward task, so no additional cleanup or iteration was needed.

## Clean up (`prune`)

`prune` cleans up disk space by removing workspaces and large artifacts for a recorded run. The run record stays in history for auditability.

Command:

```bash
voratiq prune --run 20260113-235501-hhkox --yes
```

Output:

```
Run pruned successfully.
```

The run record stays in history for reference, but the heavy artifacts are gone.

## Conclusion

Here we used Voratiq to implement a real feature: a `--branch` flag for `voratiq run`.

We wrote a high level description, generated a spec, ran 12 agents in parallel, reviewed the top candidates, and merged the best diff.

Questions, comments, or just want to chat? Open an issue on [GitHub](https://github.com/voratiq/voratiq/issues) or reach out to [support@voratiq.com](mailto:support@voratiq.com).
