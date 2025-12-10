#!/usr/bin/env python3
import argparse
import errno
import sys
from pathlib import Path

parser = argparse.ArgumentParser(
    description="Attempt to write a file for sandbox verification."
)
parser.add_argument("--target", required=True)
args = parser.parse_args()

path = Path(args.target)
path.parent.mkdir(parents=True, exist_ok=True)

try:
    path.write_text("sandbox-write", encoding="utf-8")
except PermissionError as exc:
    print(f"write failed: {exc.strerror or exc}", file=sys.stderr)
    sys.exit(42)
except OSError as exc:
    message = exc.strerror or str(exc)
    print(f"write failed: {message}", file=sys.stderr)
    if exc.errno in {errno.EACCES, errno.EPERM, errno.EROFS}:
        sys.exit(42)
    sys.exit(1)
else:
    print(f"wrote to {path}")
    sys.exit(0)
