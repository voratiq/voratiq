---
title: Troubleshooting
---

# Troubleshooting

Common issues when getting started with Voratiq.

This page covers the local runtime path.

## `voratiq` Does Not Launch Interactively

Voratiq runs from a git repo root.

Make sure you are in a repo root:

```bash
git status
```

If needed:

```bash
git init
voratiq
```

## Preflight Fails Before A Run

Common causes:

- the working tree is dirty
- git user identity is missing
- an agent CLI is not installed or not on `PATH`
- an agent CLI is installed but not authenticated

Check the repo state:

```bash
git status --short
```

Coding flows (`run`, `verify --run`, `apply`, `auto`) require a clean working tree so Voratiq can compare and apply recorded diffs safely.

Check the agent CLIs directly:

```bash
codex --help
claude --help
gemini --help
```

Authenticate with the provider's native workflow before retrying Voratiq.

If the workspace itself looks incomplete or inconsistent, diagnose it directly:

```bash
voratiq doctor
voratiq doctor --fix
```

## Runs Fail In A Fresh Repo

Some flows work best once the repo has at least one commit.

If you only need a commit boundary in a brand-new repo, prefer an empty commit:

```bash
git commit --allow-empty -m "Initialize repo for Voratiq"
```

If you also need to commit files, stage only what you intend to keep.

## Verification Feels Quiet

Voratiq records session state under `.voratiq/`, but some commands produce little output while running.

Use `list` to inspect recent sessions:

```bash
voratiq list --spec
voratiq list --run
voratiq list --reduce
voratiq list --verify
voratiq list --message
voratiq list --interactive
```

## `.voratiq/` Appears In The Working Tree

Voratiq stores workspace state and session history under `.voratiq/`.

That is expected. If you do not want those files in version control, add `.voratiq/` or the relevant subpaths to `.gitignore` according to your workflow.

## Still Need Help?

If you still need help, please reach out to [support@voratiq.com](mailto:support@voratiq.com).
