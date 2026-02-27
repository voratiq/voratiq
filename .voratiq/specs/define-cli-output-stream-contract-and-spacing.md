# Define CLI Output Stream Contract and Spacing

## Summary

Establish a single, explicit output contract for all user-facing CLI transcript content so section ordering and spacing remain deterministic across commands, while preserving color/styling for warning/error labels.

## Problem Statement

Current commands sometimes split one logical output block across `stdout` and `stderr` (for example: hint text on `stdout` and advisory warning text on `stderr`). In chained output mode this can produce inconsistent visual grouping and spacing in terminal output.

## Goals

- Define where each class of message should go (`stdout` vs `stderr`).
- Keep transcript-like content consistently ordered and spaced.
- Preserve warning/error visual styling (e.g., yellow `Warning:` labels) without forcing advisory messages to `stderr`.
- Make behavior testable with merged-output integration coverage, not only per-stream assertions.

## Non-Goals

- Redesign transcript text content or command semantics.
- Change provider/runtime subprocess stderr capture semantics.
- Introduce breaking changes to machine-readable artifacts.

## Contract

- `stdout`
  - All user-facing transcript/narrative output: headings, section separators, hints, next actions, advisory warnings, summaries.
  - Styled warning lines are allowed in `stdout` (e.g., `formatAlertMessage("Warning", "yellow", ...)`).
- `stderr`
  - Fatal command errors and raw subprocess/runtime stderr payloads.
  - Operational diagnostics intended for failure/debug channels.
- A single logical block must not be split across `stdout` and `stderr`.

## Acceptance Criteria

- Commands that emit advisory warnings adjacent to transcript/hint content render those warnings on `stdout` with preserved warning styling.
- `stderr` is reserved for failure-path errors and forwarded subprocess stderr.
- Chained output spacing remains deterministic for normal success paths.
- Add/adjust tests to validate merged human-visible ordering for at least one representative command path.
- Existing command exit codes and failure semantics remain unchanged.

## Implementation Touchpoints

- `src/cli/output.ts`
- `src/cli/auto.ts`
- `src/cli/review.ts`
- `src/cli/list.ts`
- `src/render/transcripts/*`
- `tests/cli/*`

## Test Plan

- Add integration-style assertions for merged output ordering/spacing in selected `auto` and `review` paths.
- Keep stream-specific assertions where they validate true stderr behavior (hard failures / forwarded stderr).
- Verify ANSI-stripped snapshots still contain expected warning text and section sequence.
