#!/usr/bin/env python3
"""Helper used while scaffolding: writes many files from a {path: content} mapping in one go."""
import os, sys, json
def write_all(files, root="src/app/api"):
    for path, content in files.items():
        full = os.path.join(root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(content.lstrip("\n"))
    print(f"wrote {len(files)} files")
