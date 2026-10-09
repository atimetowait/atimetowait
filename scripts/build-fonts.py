#!/usr/bin/env python3
"""Subset JetBrains Mono into the handful of woff2 faces this site actually uses.

The typeface used to arrive via `@import url(fonts.cdnfonts.com/...)` at the top of
src/index.css. That is the worst possible place for it: an @import *inside* the main
stylesheet serialises four round trips before any text can paint -- HTML, then
index.css, then the CDN's own stylesheet, then the font files themselves -- and it
hands a third party the ability to break the site's typography.

It mattered more here than on an ordinary page, too. Every measurement on this site is
in `ch` and the ASCII art is cover-fitted by `calc(100vw / (cols * 0.6))`, which is the
typeface's own advance width written into the stylesheet (src/index.css, .header-art).
A fallback face swapping in late doesn't just reflow some prose, it re-lays-out the
artwork.

So the faces are built here instead, from the system copies, and served same-origin.
Each is subset to the codepoints the site genuinely contains -- verified against every
markdown file, art file, template and script, not guessed -- which takes a ~275 KB TTF
down to ~18 KB.

JetBrains Mono is SIL Open Font License 1.1, so redistributing a subset is fine; the
licence travels with the output in src/fonts/OFL.txt.

Run via `make fonts`. The outputs are committed, because the source TTFs are a system
dependency the site itself must not have.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path("/usr/share/fonts/TTF")
DEFAULT_OUTPUT = ROOT / "src" / "fonts"

# (source suffix, output stem) for the faces the stylesheet can actually select.
#
# The sheet declares exactly three weights -- --font-weight-normal 500,
# --font-weight-medium 600, --font-weight-bold 800 -- and italic reaches 500 (em,
# figcaption, .archive-empty, .ledger-updated) and 800 (details.details-plain summary,
# which is italic *and* bold). SemiBold italic is the one combination nothing selects,
# so it isn't built: an unused face is still a file someone has to wonder about.
FACES = [
    ("Medium", "jetbrains-mono-500"),
    ("MediumItalic", "jetbrains-mono-500-italic"),
    ("SemiBold", "jetbrains-mono-600"),
    ("ExtraBold", "jetbrains-mono-800"),
    ("ExtraBoldItalic", "jetbrains-mono-800-italic"),
]

# Latin-1 wholesale (it is nearly free, covers the é/ö/·/nbsp the prose already uses,
# and leaves room for ordinary writing), plus precisely the typographic marks and
# symbols found in the content: en/em dash, curly quotes, ellipsis, the three arrows
# the terminal and the "← Musings" link print, and the two triangles <details> uses
# for its marker.
UNICODES = ",".join(
    [
        "U+0000-00FF",
        "U+2013-2014",  # en dash, em dash
        "U+2018-201D",  # curly single and double quotes
        "U+2026",  # ellipsis
        "U+2190",  # <- "Musings"
        "U+2192",  # -> terminal's cd/open echo
        "U+2197",  # ^ "read the rest"
        "U+25B6",  # > details marker, closed
        "U+25BC",  # v details marker, open
    ]
)

# tnum/lnum are not decoration here: `font-variant-numeric: tabular-nums lining-nums`
# is set on :root and relied on by every date column (.journal-date, .archive-date,
# .ledger-entries dt). Dropping those features would silently un-align them.
LAYOUT_FEATURES = "kern,liga,calt,tnum,lnum"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"directory holding JetBrainsMono-*.ttf (default {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"directory to write the woff2 faces into (default {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not shutil.which("pyftsubset"):
        sys.exit("missing pyftsubset -- install fonttools (with brotli for woff2)")

    args.output.mkdir(parents=True, exist_ok=True)
    total = 0

    for suffix, stem in FACES:
        source = args.source / f"JetBrainsMono-{suffix}.ttf"
        if not source.exists():
            sys.exit(f"missing {source} -- pass --source, or install the ttf-jetbrains-mono package")

        target = args.output / f"{stem}.woff2"
        subprocess.run(
            [
                "pyftsubset",
                str(source),
                f"--output-file={target}",
                "--flavor=woff2",
                f"--unicodes={UNICODES}",
                f"--layout-features={LAYOUT_FEATURES}",
                # The faces are served to a browser that does its own rasterising, and
                # the glyf hinting is a meaningful share of the bytes.
                "--no-hinting",
                "--desubroutinize",
            ],
            check=True,
        )
        size = target.stat().st_size
        total += size
        print(f"wrote {target.relative_to(ROOT)} ({size:,} bytes from {source.stat().st_size:,})")

    print(f"{len(FACES)} faces, {total:,} bytes total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
