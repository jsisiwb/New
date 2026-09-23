"""Output-shape blocks generated from the answer schema (ADR-0057).

The schema is the contract: `tools/render-shape.ts` walks the family's answer schema (packages/prompts
OUTPUT_SHAPES, one source of truth) together with the current example, keeps its Korean placeholder text,
adds every required field, lists only schema enum values and derives the shape notes. This module only
splices the result into a prompt template.
"""
from __future__ import annotations

import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LABEL_PREFIX = "[출력 스키마"


def render(family: str, base_example: object) -> dict:
    out = subprocess.run(
        ["npx", "--no-install", "tsx", "tools/render-shape.ts", family],
        input=json.dumps(base_example, ensure_ascii=False),
        capture_output=True, text=True, cwd=ROOT, check=True,
    )
    return json.loads(out.stdout)


def shape_lines(family: str, base_example: object) -> list[str]:
    d = render(family, base_example)
    filled = d["workflow_filled"]
    label = "[출력 스키마 — 이 JSON 필드를 반환한다" + (
        f". 워크플로가 채우는 필드: {', '.join(filled)}]" if filled else "]"
    )
    return [label, json.dumps(d["example"], ensure_ascii=False), *d["notes"]]


def replace_shape(template: str, family: str) -> str:
    """Swap the template's label + example lines for the generated block (following notes are kept)."""
    lines = template.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith(LABEL_PREFIX)]
    if len(idx) != 1:
        raise SystemExit(f"{family}: expected one output-shape label, found {len(idx)}")
    i = idx[0]
    base = json.loads(lines[i + 1])
    return "\n".join(lines[:i] + shape_lines(family, base) + lines[i + 2:])


def latest(family: str) -> tuple[str, str, str]:
    """(version, system, user) of the family's highest registered version."""
    base = os.path.join(ROOT, "packages", "prompts", "families", family)
    versions = sorted(
        (d[1:] for d in os.listdir(base) if d.startswith("v")),
        key=lambda v: tuple(int(x) for x in v.split(".")),
    )
    v = versions[-1]
    d = os.path.join(base, f"v{v}")
    return v, open(os.path.join(d, "system.md"), encoding="utf-8").read(), open(
        os.path.join(d, "user.md"), encoding="utf-8").read()
