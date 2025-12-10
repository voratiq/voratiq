---
title: Environment Configuration
---

# Environment Configuration

Expose language-specific dependencies to agents at runtime.

## Overview

Voratiq reads `.voratiq/environment.yaml` to locate Node.js and Python dependencies agents need during code generation and evaluation. `voratiq init` detects `node_modules` and common virtual environment directories. Edit the file to add custom paths or disable runtimes.

Pre-populating dependencies locally is safer than granting agents network access to install packages at runtime. It avoids executing arbitrary install scripts during agent execution (see [Sandbox Configuration](https://github.com/voratiq/voratiq/blob/main/docs/configs/sandbox.md)).

## Schema

Top-level structure:

- `node` (optional) – Node.js dependency configuration.
- `python` (optional) – Python environment configuration.

Each language entry may be:

- An object with language-specific fields (see below).
- `false` to explicitly disable the language environment.
- Omitted to skip the language configuration.

**Node.js configuration** (when object):

- `dependencyRoots` (required) – array of paths to search for installed packages.

**Python configuration** (when object):

- `path` (required) – path to a virtual environment directory.

## `environment.yaml` Examples

### Node Dependencies

```yaml
node:
  dependencyRoots:
    - node_modules
```

Standard setup. Voratiq detects this during `voratiq init` when `node_modules` exists.

### Python Virtual Environment

```yaml
python:
  path: .venv
```

Points to a `.venv` directory. Voratiq detects `.venv` and `venv` during `voratiq init` when they exist.

### Both Environments

```yaml
node:
  dependencyRoots:
    - node_modules

python:
  path: .venv
```

Configure Node.js and Python together for polyglot repositories.

### Multiple Node Roots

```yaml
node:
  dependencyRoots:
    - node_modules
    - packages/shared/node_modules
```

List multiple search paths for monorepos. Voratiq deduplicates entries.

### Custom Python Path

```yaml
python:
  path: envs/production
```

Use a non-standard virtual environment location. The path must exist at runtime; Voratiq does not create it.

### Disable Node.js

```yaml
node: false

python:
  path: .venv
```

Disable Node.js while keeping Python configured.

### Disable Python

```yaml
node:
  dependencyRoots:
    - node_modules

python: false
```

Disable Python while keeping Node.js configured.
