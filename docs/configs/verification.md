---
title: Verification Configuration
---

# Verification Configuration

After `spec`, `run`, or `reduce` agents produce candidate outputs, the verification operator checks and scores them. `verification.yaml` controls what gets checked and how.

## Overview

Two methods:

- **Programmatic** (run only): shell commands — tests, linters, build checks — that gauge correctness and style automatically.
- **Rubric**: verifier agents score candidates against a structured rubric.

Results are saved under `.voratiq/verify/`.

## Schema

Top-level keys match the stages that `verify` can target:

- `spec` (optional): rubric verification for spec drafts
- `run` (optional): programmatic + rubric verification for run candidates
- `reduce` (optional): rubric verification for reductions

Each stage block has:

- `programmatic` (run only): map of `slug: command` pairs (omitted or empty commands are skipped)
- `rubric`: list of `{ template: <name> }` entries

## Example

```yaml
spec:
  rubric:
    - template: spec-verification

run:
  programmatic:
    format: "npm run format:check"
    lint: "npm run lint"
    typecheck: "npm run typecheck"
    tests: "npm test"
  rubric:
    - template: run-verification

reduce:
  rubric:
    - template: reduce-verification
```

## Templates

Rubric templates live under `.voratiq/verify/templates/<name>/`:

- `prompt.md` — instructions for the verifier
- `rubric.md` — scoring criteria
- `schema.yaml` — expected output structure

`voratiq init` seeds default templates and a starter `verification.yaml`.
