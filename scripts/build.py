#!/usr/bin/env python3
"""Build static HTML pages (cross-platform alternative to make)."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PANDOC = [
    "pandoc",
    "-s",
    "--css",
    "/src/reset.css",
    "--css",
    "/src/index.css",
    "--template",
    "demo/template.html",
]
JOURNAL_FORMAT = "markdown+hard_line_breaks"
MUSINGS_DIR = ROOT / "demo" / "musings"


def version_and_date() -> tuple[str, str]:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return f"v{package['version']}", date.today().isoformat()


def run_pandoc(input_path: Path, output_path: Path, *, journal: bool = False) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    version, build_date = version_and_date()
    cmd = [
        *PANDOC,
        f"-Vversion={version}",
        f"-Vdate={build_date}",
    ]
    if journal:
        cmd.extend(["-f", JOURNAL_FORMAT])
    cmd.extend(["-i", str(input_path), "-o", str(output_path)])
    subprocess.run(cmd, cwd=ROOT, check=True)


def build_musings_index() -> None:
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build-musings-index.py")],
        cwd=ROOT,
        check=True,
    )


def journal_entries() -> list[Path]:
    return sorted(
        path
        for path in MUSINGS_DIR.glob("*.md")
        if not path.name.startswith("_")
    )


def main() -> int:
    build_musings_index()
    run_pandoc(ROOT / "demo" / "index.md", ROOT / "index.html")
    run_pandoc(ROOT / "demo" / "musings.generated.md", ROOT / "musings" / "index.html")
    run_pandoc(ROOT / "demo" / "bookkeeping.md", ROOT / "bookkeeping" / "index.html")
    run_pandoc(ROOT / "demo" / "sightseeing.md", ROOT / "sightseeing" / "index.html")
    for entry in journal_entries():
        slug = entry.stem
        run_pandoc(entry, ROOT / "musings" / slug / "index.html", journal=True)
    print("Build complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
