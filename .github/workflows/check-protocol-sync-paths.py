#!/usr/bin/env python3
"""Fail if the protocol-sync trigger list drifts across the three copies.

The three copies are:
- the unlabeled fence under the trigger-path heading in evidence/protocol-sync-gate.md
- the first unlabeled path fence in CONTRIBUTING.md
- the paths between BEGIN/END markers in .github/workflows/protocol-sync.yml
"""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "evidence" / "protocol-sync-gate.md"
CONTRIBUTING = ROOT / "CONTRIBUTING.md"
WORKFLOW = ROOT / ".github" / "workflows" / "protocol-sync.yml"
BEGIN = "      # BEGIN protocol-sync-paths"
END = "      # END protocol-sync-paths"


def unlabeled_fences(text: str) -> list[list[str]]:
    lines = text.splitlines()
    blocks: list[list[str]] = []
    index = 0
    while index < len(lines):
        if lines[index].strip() == "```":
            index += 1
            body: list[str] = []
            while index < len(lines) and not lines[index].startswith("```"):
                body.append(lines[index])
                index += 1
            blocks.append(body)
        index += 1
    return blocks


def path_fence(text: str, label: str) -> list[str]:
    matches = [
        [line for line in block if line.strip()]
        for block in unlabeled_fences(text)
        if "src/agent/modules/protocol.ts" in block and "pnpm-lock.yaml" in block
    ]
    if len(matches) != 1:
        raise SystemExit(f"{label}: expected 1 trigger-path fence, found {len(matches)}")
    return matches[0]


def gate_paths(text: str) -> list[str]:
    heading = "## 触发路径"
    start = text.find(heading)
    if start < 0:
        raise SystemExit("protocol-sync-gate.md: trigger-path heading missing")
    return path_fence(text[start:], "protocol-sync-gate.md")


def workflow_paths(text: str) -> list[str]:
    lines = text.splitlines()
    try:
        start = lines.index(BEGIN)
        end = lines.index(END)
    except ValueError as error:
        raise SystemExit(f"protocol-sync.yml: path markers missing ({error})") from error
    if end < start:
        raise SystemExit("protocol-sync.yml: path markers out of order")
    paths: list[str] = []
    for line in lines[start + 1 : end]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not stripped.startswith("- "):
            raise SystemExit(f"protocol-sync.yml: bad path line: {stripped}")
        paths.append(stripped[2:].strip().strip("'\""))
    return paths


def main() -> int:
    gate = gate_paths(GATE.read_text(encoding="utf-8"))
    contributing = path_fence(CONTRIBUTING.read_text(encoding="utf-8"), "CONTRIBUTING.md")
    workflow = workflow_paths(WORKFLOW.read_text(encoding="utf-8"))
    if not (gate == contributing == workflow):
        print("FAIL protocol-sync paths diverged")
        print("--- evidence/protocol-sync-gate.md ---")
        print("\n".join(gate))
        print("--- CONTRIBUTING.md ---")
        print("\n".join(contributing))
        print("--- .github/workflows/protocol-sync.yml ---")
        print("\n".join(workflow))
        return 1
    if "rust-core/**" not in gate:
        print("FAIL rust-core/** missing from trigger paths")
        return 1
    print(f"PASS protocol-sync paths identical ({len(gate)} entries, includes rust-core/**)")
    for path in gate:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
