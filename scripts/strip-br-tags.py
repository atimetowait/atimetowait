#!/usr/bin/env python3
"""Replace <br> tags in musings markdown with newline-based formatting."""

import re
import sys
from pathlib import Path


def convert_br(text: str) -> str:
    # Paragraph breaks first.
    text = re.sub(r"<br\s*/?>\s*<br\s*/?>", "\n\n", text, flags=re.IGNORECASE)
    # Trailing br before newline: rely on hard_line_breaks for the line break.
    text = re.sub(r"<br\s*/?>\s*\n", "\n", text, flags=re.IGNORECASE)
    # Mid-line br.
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def convert_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if "<br" not in original.lower():
        return False

    if original.startswith("---"):
        end = original.index("---", 3)
        front_matter = original[: end + 3]
        body = original[end + 3 :].lstrip("\n")
        converted = convert_br(body)
        path.write_text(f"{front_matter}\n{converted}", encoding="utf-8", newline="\n")
    else:
        path.write_text(convert_br(original), encoding="utf-8", newline="\n")
    return True


def main() -> int:
    base = Path(__file__).resolve().parents[1] / "demo" / "musings"
    paths = [Path(p) for p in sys.argv[1:]] if len(sys.argv) > 1 else sorted(base.glob("*.md"))
    changed = 0
    for path in paths:
        if path.name.startswith("_"):
            continue
        if convert_file(path):
            changed += 1
            print(path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
