# Per-page art

Drop a plain-text drawing here and rebuild. That's the whole contract — art is
opt-in by file existence, so a page with no file simply has no backdrop.

## Where and how it's named
'demo/art/thisbias.txt'

- **Section pages** — name it after the section: `musings.txt`,
  `sightseeing.txt`, `listen.txt`, `bookkeeping.txt`, `archive.txt`.
- **Journal entries** — name it after the entry's slug, i.e. the markdown
  file's own name: `demo/musings/icymi.md` → `demo/art/icymi.txt`.

The homepage's own full-bleed portrait is a separate, older file
(`demo/header-art.txt`) and isn't part of this folder.

## Shape

- **Size** — anything. Something in the range of ~120–220 columns by
  ~40–60 rows is the sweet spot for how it gets displayed; ragged rows are
  padded to a rectangle automatically, so it doesn't need to be exact.
- **Aspect ratio** — roughly 1.6:1 to 2:1 crops less across both desktop and
  phone than the homepage's own 2.34:1.
- **Characters** — any printable ASCII. Tone is *measured*, not guessed: each
  glyph you use gets rendered in the site's typeface and its ink coverage
  measured, so the darkest and lightest characters in your drawing become the
  darkest and lightest tiers automatically. Draw by eye; don't worry about
  which characters read as "heavier."
- **Alt text** — optional. Add a sibling file `demo/art/<name>.txt.alt` with
  one line describing the image, for screen readers. Without one, a generic
  description is used.

## How it's shown

Unlike the homepage's full-viewport portrait, this art sits as a faint,
fixed backdrop behind the page — bold in the margins, and only lightly
present behind the text column itself, so it doesn't fight readability. It's
tinted and animated by the same system as the homepage art (mood colour,
theme, the ambient twinkle, the red blink, melting under the cursor) with no
extra work on your end.

## Building it

`make` picks up anything in this folder automatically — no Makefile changes,
no per-page wiring. Run it after adding or editing a file here:

    make

If you want to preview a single piece without a full rebuild, you can run the
generator directly:

    python3 scripts/build-header-art.py --source demo/art/myownkin.txt \
        --output demo/art/myownkin.generated.html --class art-backdrop
