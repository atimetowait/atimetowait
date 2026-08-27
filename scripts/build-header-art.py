#!/usr/bin/env python3
"""Turn the ASCII art in demo/header-art.txt into markup the homepage can animate.

The art used to ship as a flat JPEG, which meant it could not react to anything --
a raster has no characters to address. Emitting it as real text gives src/header-art.js
a grid of cells to distort, melt and recolour.

Each character becomes its own <span>, carrying a tone tier derived from how much ink
that glyph actually puts on the page in JetBrains Mono (the face the art is displayed
in). That keeps the image's tonal structure while letting JS repaint any cell.

Output:
  demo/header-art.generated.html  a <pre> of ROWS row spans, each of COLS char spans
"""

from __future__ import annotations

import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "demo" / "header-art.txt"
OUTPUT = ROOT / "demo" / "header-art.generated.html"

FONT_PATH = "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf"

# Tone tiers. The palette in index.css defines .k0 .. .k{TONE_TIERS-1}; keep the two
# in step if this changes.
TONE_TIERS = 8

# Screen readers get the description, not ten thousand punctuation marks.
DESCRIPTION = "ASCII art portrait rendered in monospace characters."


def load_rows() -> list[str]:
    """Read the art, drop trailing blank lines, and pad every row to a rectangle.

    The renderer indexes cells as row * cols + col, so a ragged grid would silently
    misalign every row after the first short one.
    """
    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE.relative_to(ROOT)}")

    text = SOURCE.read_text(encoding="utf-8")
    rows = text.split("\n")
    while rows and not rows[-1].strip():
        rows.pop()
    if not rows:
        sys.exit(f"{SOURCE.relative_to(ROOT)} is empty")

    width = max(len(row) for row in rows)
    return [row.ljust(width) for row in rows]


def ink_weights(chars: set[str]) -> dict[str, float]:
    """Mean coverage of each glyph, 0..1, measured by actually rendering it.

    Ordering the ramp by eye gets the mid-tones wrong, and the art leans on ~60
    distinct characters, so measure rather than guess. Falls back to a flat field if
    Pillow or the font is unavailable -- the art still renders, just without tonal
    variation, which is better than failing the build.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("note: Pillow missing, tone tiers flattened", file=sys.stderr)
        return {char: 0.5 for char in chars}

    try:
        font = ImageFont.truetype(FONT_PATH, 32)
    except OSError:
        print(f"note: {FONT_PATH} missing, tone tiers flattened", file=sys.stderr)
        return {char: 0.5 for char in chars}

    weights = {}
    for char in chars:
        cell = Image.new("L", (24, 40), 0)
        ImageDraw.Draw(cell).text((2, 2), char, fill=255, font=font)
        weights[char] = sum(cell.tobytes()) / (255 * 24 * 40)

    span = max(weights.values()) - min(weights.values())
    if span <= 0:
        return {char: 0.5 for char in chars}

    low = min(weights.values())
    return {char: (value - low) / span for char, value in weights.items()}


def tier_of(weight: float) -> int:
    return min(TONE_TIERS - 1, int(weight * TONE_TIERS))


def build(rows: list[str]) -> str:
    weights = ink_weights(set("".join(rows)))

    row_markup = []
    for row in rows:
        cells = [
            f'<span class="k{tier_of(weights[char])}">{html.escape(char)}</span>'
            for char in row
        ]
        row_markup.append(f'<span class="header-art-row">{"".join(cells)}</span>')

    # Real newlines between rows, and none just inside the <pre> tags: inside a
    # <pre> the newline itself does the line breaking, so the art still stacks
    # correctly even if the stylesheet never loads.
    art = "\n".join(row_markup)

    return (
        '<div class="header-art-wrap">\n'
        f'<p class="visually-hidden">{html.escape(DESCRIPTION)}</p>\n'
        f'<pre class="header-art" aria-hidden="true">{art}</pre>\n'
        '</div>\n'
    )


def main() -> None:
    rows = load_rows()
    OUTPUT.write_text(build(rows), encoding="utf-8")
    print(
        f"wrote {OUTPUT.relative_to(ROOT)} "
        f"({len(rows)} rows x {len(rows[0])} cols = {len(rows) * len(rows[0])} cells)"
    )


if __name__ == "__main__":
    main()
