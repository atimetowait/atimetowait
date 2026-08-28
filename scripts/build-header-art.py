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
also configurable (--class), and that flag now picks between two genuinely different
emitters, because the two uses have opposite needs:

  header-art-wrap (homepage hero)
      One <span> per character. src/header-art.js addresses cells as row*COLS+col to
      melt them under the pointer, tear rows on scroll and type the art in on load, so
      every cell has to be individually addressable. ~10k cells at ~19px is affordable.

  art-backdrop (every other page)
      One <span> per RUN of adjacent characters sharing a tone tier. In a monospace
      <pre> that renders identically -- same glyphs, same class, same width -- but on
      the mirrored backdrops it removes 86-91% of the DOM, because those pieces are
      mostly flat fill. No JS runs on these at all; movement comes from CSS keyframes
      on a sparse subset of runs tagged here at build time (tw0..tw5 twinkle, rb0..rb2
      red blink), so the main thread stays free.

      These backdrops render at ~5-9px, a third of the homepage's size, behind a mask
      and at ~34% opacity -- per-character detail there is imperceptible, so paying
      per-character DOM for it was pure cost.

Output: a <div class="header-art-wrap"> (or --class) wrapping a <pre> of ROWS row
spans, carrying the grid's dimensions as CSS custom properties so the stylesheet is not
stuck assuming one fixed size.
"""

from __future__ import annotations

import argparse
import html
import itertools
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "demo" / "header-art.txt"
DEFAULT_OUTPUT = ROOT / "demo" / "header-art.generated.html"
DEFAULT_DESCRIPTION = "ASCII art portrait rendered in monospace characters."
DEFAULT_CLASS = "header-art-wrap"
BACKDROP_CLASS = "art-backdrop"

FONT_PATH = "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf"

# Tone tiers. The palette in index.css defines .k0 .. .k{TONE_TIERS-1}; keep the two
# in step if this changes.
TONE_TIERS = 8

# --- backdrop motion tagging -------------------------------------------------
# Which runs are eligible to be animated by CSS. Only SHORT runs carrying real ink:
# a long run is a stretch of flat fill, and animating one would pulse a conspicuous
# bar rather than a character. Keeping the cap low keeps the twinkle reading as
# individual glyphs, the way the old per-cell JS version did.
MOTION_MAX_RUN = 4
MOTION_MIN_TIER = 3

# Share of eligible runs that get each effect, before --flare scales them. Phase
# buckets exist so nothing ever pulses in unison (the same photosensitivity rule the
# JS version followed); index.css staggers each bucket's animation-delay.
#
# Both the scanline sweep and the whole-piece drift that used to carry this
# piece's "alive" feeling were dropped (see BACKDROP MOTION in index.css --
# both produced a travelling line, for different reasons) -- these shares were
# raised, and MOTION_MIN_TIER loosened, to put that motion budget here
# instead: more eligible cells, spread across more of the art's tonal range
# rather than clustered on only its darkest detail, all scoped to individual
# glyphs rather than the whole masked layer.
TWINKLE_SHARE = 0.24
TWINKLE_PHASES = 6
BLINK_SHARE = 0.09
BLINK_PHASES = 4

# Long runs -- the piece's flat fill, wherever it sits in the tone range -- are
# excluded from the weighted logic above entirely (MOTION_MAX_RUN), so on their
# own they get no animation at all. That includes the dominant fill blocks in
# the margins/corners: measured on musings, 49,120 of its 65,120 characters
# live in a handful of runs this long at tier 7 alone, i.e. nearly the whole
# piece outside the figure itself -- not low-tier "blank" cells, just the same
# heavy fill character repeated. A red blink sets a solid `color: var(--art-red)`
# at its peak (see art-blink in index.css) regardless of the cell's own tier, so
# it flashes the same whether carved from faint fill or heavy fill.
#
# Rated per character, not per run, and scanned independently along the run:
# a short run of the site's usual size gets roughly nothing, while a
# multi-thousand-character corner block gets a handful of sparks scaled to its
# size -- never merged-and-tagged wholesale, which would recreate exactly the
# wide moving bar the scanline and drift were dropped for.
FILL_MIN_RUN = 8
FILL_GLINT_RATE = 0.0012


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
    parser.add_argument(
        "--flare",
        type=float,
        default=1.0,
        help="per-piece animation intensity (default 1.0). On a backdrop it scales "
        "how many runs get tagged for the CSS twinkle/blink, baked in at build time; "
        "on the homepage it is written out as --art-flare for header-art.js to read.",
    )
    parser.add_argument(
        "--tiers",
        type=int,
        default=TONE_TIERS,
        help=f"tone tiers to quantize to (default {TONE_TIERS}, matching index.css's "
        "k0..k7). Lower values only matter for a backdrop: fewer tiers means more "
        "adjacent cells share a class, so run-merging collapses more of them into "
        "fewer spans -- a genuine tradeoff against tonal nuance, useful on a piece "
        "whose detail resists merging at the default 8 (see demo/art/README.md).",
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


def tier_of(weight: float, tiers: int = TONE_TIERS) -> int:
    """Quantize into `tiers` buckets for merging, then remap onto the CSS
    palette's full 0..TONE_TIERS-1 scale.

    Fewer buckets means more adjacent characters land in the *same* bucket
    (the actual point of --tiers: more of them then merge into one span), but
    each .k0..k7 rule in index.css has a fixed --t regardless of how many
    buckets this piece uses. Returning the raw bucket index unmodified would
    mean a piece quantized to, say, 5 buckets never emits k5/k6/k7 at all --
    its darkest content capped at k4's 62% ink instead of reaching k7's 100%.
    Remapping keeps the full visual range; only the number of distinct steps
    within it changes.
    """
    bucket = min(tiers - 1, int(weight * tiers))
    if tiers == TONE_TIERS:
        return bucket
    return round(bucket / (tiers - 1) * (TONE_TIERS - 1))


def render_cells(
    rows: list[str], weights: dict[str, float], tiers: int = TONE_TIERS
) -> list[str]:
    """Homepage emitter: one span per character, individually addressable by JS."""
    row_markup = []
    for row in rows:
        cells = [
            f'<span class="k{tier_of(weights[char], tiers)}">{html.escape(char)}</span>'
            for char in row
        ]
        row_markup.append(f'<span class="header-art-row">{"".join(cells)}</span>')
    return row_markup


def render_runs(
    rows: list[str],
    weights: dict[str, float],
    flare: float,
    rng: random.Random,
    tone_tiers: int = TONE_TIERS,
) -> tuple[list[str], int, int]:
    """Backdrop emitter: one span per run of adjacent characters sharing a tone tier.

    Visually identical to render_cells in a monospace <pre> -- the glyphs, their order
    and their class are all unchanged -- but on the mirrored pieces it drops the node
    count by ~87%, because those are mostly long stretches of one fill character.

    Since no JS will touch these, anything that should move has to say so in its class
    here. Short, inky runs get twinkle/blink weighted by ink (see MOTION_MAX_RUN /
    MOTION_MIN_TIER); long runs -- a piece's flat fill, wherever it sits in the tone
    range -- get sparse single-character red-blink glints instead (FILL_*), since
    tagging one wholesale would pulse a visible bar rather than a glyph.
    """
    row_markup = []
    twinkles = 0
    blinks = 0

    for row in rows:
        tiers = [tier_of(weights[char], tone_tiers) for char in row]
        spans = []

        for tier, group in itertools.groupby(zip(row, tiers), key=lambda pair: pair[1]):
            text = "".join(char for char, _ in group)

            if len(text) <= MOTION_MAX_RUN and tier >= MOTION_MIN_TIER:
                # Both effects weighted by ink, the same way header-art.js weighted
                # its blink: the movement gathers on the figure's darkest detail
                # rather than scattering evenly across every eligible cell equally.
                weight = 0.2 + 0.8 * (tier / (TONE_TIERS - 1))
                classes = f"k{tier}"
                roll = rng.random()
                if roll < TWINKLE_SHARE * weight * flare:
                    classes += f" tw{rng.randrange(TWINKLE_PHASES)}"
                    twinkles += 1
                elif roll < (TWINKLE_SHARE + BLINK_SHARE) * weight * flare:
                    classes += f" rb{rng.randrange(BLINK_PHASES)}"
                    blinks += 1
                spans.append(f'<span class="{classes}">{html.escape(text)}</span>')

            elif len(text) >= FILL_MIN_RUN:
                # Independently roll every non-space character in the run (a space
                # has no ink for the red to colour, so glinting one would show
                # nothing) and build the span list around whichever positions land.
                # However many that turns out to be: none for a short-ish fill run,
                # a handful for a multi-thousand-character corner block.
                rate = FILL_GLINT_RATE * flare
                last = 0
                glinted_any = False
                for idx, ch in enumerate(text):
                    if ch == " " or rng.random() >= rate:
                        continue
                    glinted_any = True
                    if idx > last:
                        spans.append(f'<span class="k{tier}">{html.escape(text[last:idx])}</span>')
                    spans.append(
                        f'<span class="k{tier} rb{rng.randrange(BLINK_PHASES)}">'
                        f'{html.escape(ch)}</span>'
                    )
                    blinks += 1
                    last = idx + 1
                if not glinted_any:
                    spans.append(f'<span class="k{tier}">{html.escape(text)}</span>')
                elif last < len(text):
                    spans.append(f'<span class="k{tier}">{html.escape(text[last:])}</span>')

            else:
                # Neither eligible for the weighted twinkle/blink (too long or too
                # faint) nor long enough to scan for fill glints -- most commonly a
                # short low-tier run, or the awkward 5-7 length gap between the two
                # thresholds. Plain, unanimated, but it must still be emitted.
                spans.append(f'<span class="k{tier}">{html.escape(text)}</span>')

        row_markup.append(f'<span class="header-art-row">{"".join(spans)}</span>')

    return row_markup, twinkles, blinks


def build(
    rows: list[str],
    description: str,
    wrapper_class: str,
    flare: float,
    seed: str = "",
    tiers: int = TONE_TIERS,
) -> tuple[str, dict]:
    weights = ink_weights(set("".join(rows)))
    stats: dict = {}

    if wrapper_class == BACKDROP_CLASS:
        # Seeded off the piece's own name so a rebuild is byte-stable (no git churn)
        # while each piece still gets its own scatter.
        rng = random.Random(seed or wrapper_class)
        row_markup, stats["twinkles"], stats["blinks"] = render_runs(
            rows, weights, flare, rng, tone_tiers=tiers
        )
        stats["mode"] = "runs"
    else:
        row_markup = render_cells(rows, weights, tiers)
        stats["mode"] = "cells"

    # Real newlines between rows, and none just inside the <pre> tags: inside a
    # <pre> the newline itself does the line breaking, so the art still stacks
    # correctly even if the stylesheet never loads.
    art = "\n".join(row_markup)

    cols = len(rows[0])
    rows_n = len(rows)
    stats["spans"] = sum(chunk.count("<span") for chunk in row_markup)
    # Only the homepage's JS reads this; a backdrop bakes its flare in above.
    flare_style = (
        f" --art-flare:{flare};"
        if flare != 1.0 and wrapper_class != BACKDROP_CLASS
        else ""
    )

    markup = (
        f'<div class="{html.escape(wrapper_class)}">\n'
        f'<p class="visually-hidden">{html.escape(description)}</p>\n'
        f'<pre class="header-art" aria-hidden="true" '
        f'style="--art-cols:{cols}; --art-rows:{rows_n};{flare_style}">{art}</pre>\n'
        '</div>\n'
    )
    return markup, stats


def main() -> None:
    args = parse_args()
    rows = load_rows(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    markup, stats = build(
        rows,
        args.description,
        args.wrapper_class,
        args.flare,
        seed=args.source.name,
        tiers=args.tiers,
    )
    args.output.write_text(markup, encoding="utf-8")

    cells = len(rows) * len(rows[0])
    detail = f"{len(rows)} rows x {len(rows[0])} cols = {cells:,} cells"
    if stats["mode"] == "runs":
        saved = 100 * (1 - stats["spans"] / cells) if cells else 0
        detail += (
            f" -> {stats['spans']:,} spans ({saved:.0f}% fewer), "
            f"{stats['twinkles']} twinkle + {stats['blinks']} blink"
        )
    print(f"wrote {args.output} ({detail})")


if __name__ == "__main__":
    main()
