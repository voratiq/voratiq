---
title: Eval Configuration
---

# Eval Configuration

Defines automated checks that validate agent output after each agent completes.

## Overview

Voratiq reads `.voratiq/evals.yaml` for shell commands that gate a run's success. `voratiq init` seeds common scripts (tests, lint, build). Extend or replace them freely.

Each eval runs in the agent workspace after the agent completes. Voratiq records stderr/stdout in the run report.

## Schema

Top-level structure:

- Mapping of `slug` → command string.

Each eval entry:

- `slug` (key, required) – must be lowercase letters and numbers, optionally separated by dots or hyphens; cannot start/end with separators or use consecutive punctuation (e.g. `test`, `lint`, `build.prod`).
- command (value, required) – shell command to execute in the agent workspace. Set to an empty or null string to skip the eval.

## `evals.yaml` Examples

### Core Checks

```yaml
test: npm test
lint: npm run lint
typecheck: tsc --noEmit
build: npm run build
```

Default gates seeded by `voratiq init`.

### Expanded Gates

```yaml
test.unit: npm run test:unit
format: npm run format:check
audit: npm audit --audit-level=high
quality: ./scripts/check-quality.sh
```

Mix fast linters with targeted quality checks.

### Deep Analysis

```yaml
mutation: npx stryker run
fuzz: npx jazzer.js --config fuzz.config.json
codeql: bash scripts/run-codeql.sh
```

Heavyweight analysis for high-scrutiny specs.

## Custom Evals

Almost anything can be an eval. The only constraint is that success must exit zero.

Point a slug at an inline command or a script anywhere in your repository.

### Inline Commands

Simple commands that fit on one line:

```yaml
noop: "true"
always.fail: "false"
coinflip: "exit $((RANDOM % 2))"
```

### Multi-line Commands

Use `|` for longer inline logic:

```yaml
security.scan: |
  if [[ $(git branch --show-current) == "main" ]]; then
    npm audit --audit-level=critical
  else
    exit 0
  fi
```

### External Scripts

For complex checks, keep logic in a separate file. Create `scripts/assert-clean.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Workspace is dirty. Commit or stash changes before applying this agent diff."
  exit 1
fi
```

Make it executable (`chmod +x scripts/assert-clean.sh`), then reference it:

```yaml
workspace.clean: ./scripts/assert-clean.sh
```

Another script that blocks TODO comments (`scripts/check-todos.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail

if git grep -n "TODO" -- '*.ts' '*.js'; then
  echo "Found TODO comments in code"
  exit 1
fi
exit 0
```

Reference it in `evals.yaml`:

```yaml
no.todos: ./scripts/check-todos.sh
```
