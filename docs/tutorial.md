# Using Voratiq to build Voratiq

This tutorial will walk you through how to use the Voratiq CLI end-to-end to implement a real task: adding a `--branch` flag to `voratiq run`.

We use Voratiq to build Voratiq, and this is how that looks in practice. The work done here has been merged into the core codebase, which you can see in [PR #35](https://github.com/voratiq/voratiq/pull/35).

At a high level, the Voratiq workflow follows this sequence: `init` → `spec` → `run` → `verify` → `apply` → `prune`. Here's what that looked like for this feature.

## Before you start

To start, Voratiq should be installed and in your `$PATH` (`npm install -g voratiq`).

Then, you need a git repo with a clean working tree, and 1 or more authenticated CLI agents. These prerequisites are checked during preflight, and will throw an error if something is off.

## Initialize the workspace (`init`)

`init` bootstraps the workspace by creating the `.voratiq/` configs and applying the selected preset.

Command:

```bash
voratiq init --yes
```

Output:

```
Initializing Voratiq…

Configuring workspace…

CONFIGURATION  FILE
agents         .voratiq/agents.yaml
orchestration  .voratiq/orchestration.yaml
verification   .voratiq/verification.yaml
environment    .voratiq/environment.yaml
sandbox        .voratiq/sandbox.yaml

To learn more about configuration:
  https://github.com/voratiq/voratiq/tree/main/docs/configs

Voratiq initialized.

To generate a spec:
  voratiq spec --description "<what you want to build>" --agent <agent-id>
```

Check that the agents you want are in `agents.yaml` before continuing. If something's missing, add it now.

## Generate a spec (`spec`)

`spec` takes a task description and uses a sandboxed agent to generate a structured spec file.

Command:

```bash
voratiq spec \
  --description "Add a --branch flag to voratiq run that checks out (or creates) a git branch named after the spec filename before the run starts. Branch name comes from the spec basename without extension (e.g., specs/separate-verification-outcomes.md -> separate-verification-outcomes, specs/foo/bar.md -> bar). If the worktree is dirty, abort before creating any run record. If checkout/create fails, abort fast with the git error. If the branch exists, switch to it; otherwise create from HEAD. Do this as early as possible in the run lifecycle. Do not change CLI output on success. apply --commit remains unchanged and branch-agnostic. Add tests for branch name derivation, branch create vs checkout, dirty worktree fast-fail, and checkout failure." \
  --agent claude-opus-4-5-20251101
```

Output:

```
Generating specification…

Spec saved: .voratiq/spec/add-run-branch.md

To begin a run:
  voratiq run --spec .voratiq/spec/add-run-branch.md
```

One note: avoid backticks in `--description` unless you escape them. Bash interprets them as command substitution.

## Run your agents (`run`)

`run` executes your configured agents against a spec. Each agent runs in its own sandboxed environment. Voratiq captures their outputs, diffs, and summaries, and records everything to run history.

Command:

```bash
voratiq run --spec .voratiq/spec/add-run-branch.md
```

Output:

```
20260113-235501-hhkox SUCCEEDED

Elapsed        12m 11s
Created        2026-01-13 15:55 PST
Spec           .voratiq/spec/add-run-branch.md
Workspace      .voratiq/run/sessions/20260113-235501-hhkox
Base Revision  29163b77

AGENT                       STATUS     DURATION  CHANGES
claude-haiku-4-5-20251001   SUCCEEDED  4m 58s    5f +381/-2
claude-sonnet-4-5-20250929  SUCCEEDED  6m 15s    4f +265/-1
claude-opus-4-5-20251101    SUCCEEDED  5m 6s     4f +265/-1
gpt-5-codex                 SUCCEEDED  5m 26s    4f +244/-9
gpt-5-1-codex               SUCCEEDED  5m 40s    4f +261/-1
gpt-5-1-codex-max           SUCCEEDED  7m 18s    2f +260/-3
gpt-5-1-codex-max-xhigh     SUCCEEDED  12m 11s   3f +264/-1
gpt-5-1-codex-mini          SUCCEEDED  6m 9s     4f +235/-1
gpt-5-2                     SUCCEEDED  7m 5s     6f +236/-2
gpt-5-2-xhigh               SUCCEEDED  11m 37s   6f +312/-2
gpt-5-2-codex               SUCCEEDED  5m 50s    2f +175/-1
gpt-5-2-codex-xhigh         SUCCEEDED  10m 55s   4f +281/-1

To verify results:
  voratiq verify --run 20260113-235501-hhkox --agent <agent-id>
```

All 12 agents completed successfully. We use `verify` to compare implementations and find the best candidate.

## Verify the run (`verify`)

`verify` runs programmatic checks and rubric verifiers over a completed run. Verifiers come from orchestration config, or you can override them with `--agent`.

Command:

```bash
voratiq verify --run 20260113-235501-hhkox --agent gpt-5-2-codex
```

Output (truncated):

````
Verifying…

20260221-233012-txwtd SUCCEEDED

Elapsed    3m 13s
Created    2026-02-21 15:30 PST
Target     Run 20260113-235501-hhkox
Workspace  .voratiq/verify/sessions/20260221-233012-txwtd

AGENT            VERIFIER         STATUS     DURATION
gpt-5-2-codex    run-verification  SUCCEEDED  3m 13s

---

Verifier: gpt-5-2-codex

```markdown
## Recommendation
**Preferred Candidate**: claude-opus-4-5-20251101
**Rationale**: Best overall adherence with clean preflight module and explicit git error propagation; remaining follow-ups are bounded.
**Next Actions**:
voratiq apply --run 20260113-235501-hhkox --agent claude-opus-4-5-20251101
```

Verification: .voratiq/verify/sessions/20260221-233012-txwtd/gpt-5-2-codex/run-verification/result.json

---

To apply a solution:
    voratiq apply --run 20260113-235501-hhkox --agent <agent-id>
````

The verifier output is a starting point. We reviewed the top candidates ourselves, and Opus had the best implementation: a dedicated preflight module, proper edge case handling, and focused tests.

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
Spec           .voratiq/spec/add-run-branch.md
Workspace      .voratiq/run/sessions/20260113-235501-hhkox
Base Revision  29163b77

  claude-opus-4-5-20251101 SUCCEEDED

  Duration  5m 6s
  Changes   4 files changed, 265 insertions(+), 1 deletion(-)
  Root      .voratiq/run/sessions/20260113-235501-hhkox/claude-opus-4-5-20251101

  RUNTIME   PATH
  manifest  runtime/manifest.json
  sandbox   runtime/sandbox.json

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

`prune` cleans up disk space by removing workspaces and large artifacts for a recorded run.

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

We wrote a high-level description, generated a spec, ran 12 agents against the spec, reviewed the top candidates, and applied the best diff.

Questions, comments, or just want to chat? Open an issue on [GitHub](https://github.com/voratiq/voratiq/issues) or reach out to [support@voratiq.com](mailto:support@voratiq.com).
