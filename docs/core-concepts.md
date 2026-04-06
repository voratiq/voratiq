---
title: Core Concepts
---

# Core Concepts

Voratiq uses agent ensembles to design, generate, and select the best code for every task. Multiple agents work at each stage, and verification drives selection.

Five ideas shape the design:

- [Composable Operators](#composable-operators) — Six operators that work independently or chain together
- [Ensembles at Every Stage](#ensembles-at-every-stage) — Every agentic operator runs multiple agents concurrently
- [First-Class Verification](#first-class-verification) — Blinded, cross-stage evaluation that drives selection
- [Sandboxed by Default](#sandboxed-by-default) — Agents run with minimal permissions
- [Full Auditability](#full-auditability) — Complete evidence trail for every session

---

## Composable Operators

The core workflow is supported by four agentic operators:

| Operator   | Purpose                                                           |
| ---------- | ----------------------------------------------------------------- |
| **spec**   | Draft a Markdown specification from a task description            |
| **run**    | Execute agents against a spec; collect diffs and artifacts        |
| **reduce** | Synthesize artifact sets into a structured summary                |
| **verify** | Evaluate candidates with programmatic checks and rubric verifiers |

Two additional operators handle non-agentic work: `apply` merges a selected agent's diff into the working tree, and `prune` cleans up worktrees and artifacts from past sessions.

Every run starts from a Markdown spec that defines the task, constraints, and context. Voratiq converts the spec into a prompt so all agents receive identical instructions. This makes results directly comparable and runs reproducible. Write specs by hand or generate them via `voratiq spec` or `voratiq auto --description`.

The full sequence is **spec → run → reduce → verify → apply**. `voratiq auto` runs spec → run → verify by default, with apply gated behind `--apply`.

Operators are composable beyond this sequence:

- **Verify is a cross-stage gate.** It can target spec, run, reduce, or message sessions. You can verify a spec before running agents against it, verify run outputs before reduction, verify the reduction itself, or verify persisted message responses directly.
- **Reduce targets multiple operator outputs.** It can consume artifacts from spec, run, verify, or a prior reduction.

Each operator can be invoked on its own from the CLI (`voratiq spec`, `voratiq run`, `voratiq reduce`, `voratiq verify`, `voratiq apply`, `voratiq prune`) or composed with others in any order.

See [CLI Reference](cli-reference.md) for operator usage. Configuration lives in plain text (YAML, JSON, Markdown) under `.voratiq/`.

## Ensembles at Every Stage

Voratiq runs multiple agents at each agentic stage:

- **Spec** — Multiple agents draft specifications from a task description
- **Run** — Multiple agents generate candidate implementations against the same spec
- **Reduce** — Multiple agents synthesize and summarize artifact sets
- **Verify** — Multiple agents evaluate candidates against rubrics

Each agent receives identical inputs but may approach the problem differently based on its model, training, or configuration. Running diverse models surfaces different approaches and reduces single-model failure modes.

Voratiq supports agents from multiple providers (Claude, Codex, Gemini), and orchestration profiles control which agents participate at each stage. Disable agents or limit concurrency when you need results from only one.

See [Agent Configuration](configs/agents.md) and [Orchestration Configuration](configs/orchestration.md) for managing ensembles.

## First-Class Verification

Each stage runs multiple agents, producing a set of competing outputs. Verification decides which one to keep, through two channels:

- **Programmatic checks** — shell commands (test suites, linters, type checkers, builds). Automated pass/fail. Run targets only.
- **Rubric verifiers** — agents that score candidates against structured templates. Applies to spec, run, reduce, and message.

Rubric verification is **blinded**: verifiers see randomized candidate IDs, not agent names. This prevents model-loyalty bias.

Both channels feed into a selection policy that aggregates scores and recommends a winner. This is what lets `voratiq auto` pick results without manual review at every stage. When verifiers disagree, the policy surfaces the disagreement so you can decide. As workflows get more autonomous, verification is what keeps selection grounded in evidence.

See [Verification Configuration](configs/verification.md) for defining checks and rubrics.

## Sandboxed by Default

Agents run with minimal permissions. Network access is restricted to domains required by the agent's provider, and filesystem writes are limited to the agent's workspace (a git worktree) and sandbox home (for logs and temporary files).

This limits the scope of unexpected agent behavior (bugs, hallucinations, prompt injection) while allowing agents to complete work. `.voratiq/` is blocked from agent access so candidates can't see each other's work.

Sandbox enforcement includes denial backoff (repeated violations trigger warnings, then delays, then fail-fast termination) and a watchdog that monitors time and memory limits.

Sandboxing is defense in depth, not a guarantee — treat agent runs with appropriate caution.

When your workflow requires additional access (external APIs, shared caches, package registries), relax restrictions via sandbox configuration. Permissions are explicit and auditable.

See [Sandbox Configuration](configs/sandbox.md) for customizing network and filesystem policies.

## Full Auditability

Voratiq preserves an evidence trail for every session under `.voratiq/`. Ephemeral data — the prompt passed to agents and auth credentials — is cleaned up immediately after execution. What remains is the audit record: metadata, artifacts, and runtime configuration.

Example run session after teardown:

```
.voratiq/run/sessions/20260113-235501-hhkox/
├── record.json                        # Run metadata (status, agents, timestamps)
├── claude-opus-4-6/
│   ├── artifacts/
│   │   ├── diff.patch                 # Git diff of all changes
│   │   ├── stdout.log                 # Agent stdout
│   │   ├── stderr.log                 # Agent stderr
│   │   ├── summary.txt                # Agent-written summary
│   │   └── chat.jsonl                 # Full conversation trace
│   ├── runtime/
│   │   ├── manifest.json              # Binary path, args, env, workspace
│   │   └── sandbox.json               # Applied network/filesystem policies
│   └── workspace/                     # Agent's git worktree (until prune)
├── gpt-5-2-codex/
│   └── ...
└── gemini-2-5-pro/
    └── ...
```

Agent worktrees persist on disk until you run `voratiq prune`. Run records are permanent.

Spec, verification, and reduction sessions follow the same structure under `.voratiq/spec/`, `.voratiq/verify/`, and `.voratiq/reduce/`.
