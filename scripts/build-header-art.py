#!/usr/bin/env python3
"""Turn a plain-text ASCII drawing into markup a page can animate.

The art used to ship as a flat JPEG, which meant it could not react to anything --
a raster has no characters to address. Emitting it as real text gives src/header-art.js
a grid of cells to distort, melt and recolour.

Each character becomes its own <span>, carrying a tone tier derived from how much ink
that glyph actually puts on the page in JetBrains Mono (the face the art is displayed
in). That keeps the image's tonal structure while letting JS repaint any cell.

Originally hardcoded to the homepage's demo/header-art.txt. It now takes --source and
--output so any page can supply its own drawing under demo/art/ -- the wrapper class is
also configurable (--class) so the same script can produce the homepage's full-bleed
hero markup and the other pages' faint backdrop markup, while the inner <pre class=
"header-art"> stays fixed so header-art.js keeps finding it without any changes.

Output: a <div class="header-art-wrap"> (or --class) wrapping a <pre> of ROWS row
spans, each of COLS char spans, carrying the grid's dimensions as CSS custom properties
so the stylesheet is not stuck assuming one fixed size.
"""

from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "demo" / "header-art.txt"
DEFAULT_OUTPUT = ROOT / "demo" / "header-art.generated.html"
DEFAULT_DESCRIPTION = "ASCII art portrait rendered in monospace characters."
DEFAULT_CLASS = "header-art-wrap"

FONT_PATH = "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf"

# Tone tiers. The palette in index.css defines .k0 .. .k{TONE_TIERS-1}; keep the two
# in step if this changes.
TONE_TIERS = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SOURCE, help="plain-text art file to read"
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="generated HTML fragment to write"
    )
    parser.add_argument(
        "--description",
        default=DEFAULT_DESCRIPTION,
        help="alt text for screen readers (the <pre> itself is aria-hidden)",
    )
    parser.add_argument(
        "--class",
        dest="wrapper_class",
        default=DEFAULT_CLASS,
        help="class on the outer wrapping <div> -- header-art-wrap for a full-bleed "
        "hero, art-backdrop for the faint backdrop mode used on other pages",
    )
    return parser.parse_args()


def load_rows(source: Path) -> list[str]:
    """Read the art, drop trailing blank lines, and pad every row to a rectangle.

    The renderer indexes cells as row * cols + col, so a ragged grid would silently
    misalign every row after the first short one.
    """
    if not source.exists():
        sys.exit(f"missing {source}")

    text = source.read_text(encoding="utf-8")
    rows = text.split("\n")
    while rows and not rows[-1].strip():
        rows.pop()
    if not rows:
        sys.exit(f"{source} is empty")

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


def build(rows: list[str], description: str, wrapper_class: str) -> str:
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

    cols = len(rows[0])
    rows_n = len(rows)

    return (
        f'<div class="{html.escape(wrapper_class)}">\n'
        f'<p class="visually-hidden">{html.escape(description)}</p>\n'
        f'<pre class="header-art" aria-hidden="true" '
        f'style="--art-cols:{cols}; --art-rows:{rows_n}">{art}</pre>\n'
        '</div>\n'
    )


def main() -> None:
    args = parse_args()
    rows = load_rows(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build(rows, args.description, args.wrapper_class), encoding="utf-8")
    print(
        f"wrote {args.output} "
        f"({len(rows)} rows x {len(rows[0])} cols = {len(rows) * len(rows[0])} cells)"
    )


if __name__ == "__main__":
    main()
