Personal website, blog.

## Building

Markdown in `demo/` compiles to HTML committed at the repo root; GitHub Pages
serves the repo as-is, so **the built HTML must be committed**.

```
make            # build everything
make clean      # remove generated files only (never touches the photographs)
make watch      # rebuild on change
```

`scripts/build.py` does the same thing without `make`, for Windows.

Requires `pandoc`, `python3`, `jq`, `make`.

## Adding an entry

Copy `demo/musings/_template.md` to `demo/musings/<slug>.md` and fill in the
front matter. Everything else — the musings index, the archive page, and the
terminal's `site-manifest.json` — regenerates from it. Nothing needs updating
by hand.

Front matter fields:

| field | what it does |
|---|---|
| `page-title` | the entry's title |
| `date` | sorts the index; it does not have to be a real date |
| `summary` | the one-line hook shown in the index |
| `tags` | free-form; becomes a filter button on the archive page |
| `mood` | tints the page — `bone`, `bruise`, `vhs`, `ember`, `amber`, `iodine` |

## In an entry

Lines fade in on scroll automatically. To make a phrase scramble under the
cursor, wrap it: `[these words]{.glitch}`

Both effects disable themselves under `prefers-reduced-motion`, and neither is
needed to read the page — with JavaScript off, everything is plain visible text.

## The terminal

`src/terminal.js` builds the prompt. It reads `site-manifest.json` for `ls`,
`cat`, `find`, and tab-completion, so that file must be committed alongside the
HTML. `help` lists the commands; a few others aren't listed.

It takes two shapes:

- **The homepage** sets `terminal-home: true` in its front matter, which makes
  the template leave a `<div id="tty-mount">` near the top. The terminal takes
  that spot as the page's front door and boots with `help` already run. It
  focuses itself only where there's a real keyboard, so phones don't get the
  software keyboard thrown at them on arrival.
- **Every other page** gets the same terminal, quietly, in the footer.

Without JavaScript the mount div collapses to nothing, the Site Guide stays
open, and the homepage reads as ordinary prose.

### The homepage prose

The intro and the "what atimetowait means" text stay in `demo/index.md` as
normal content, wrapped as `#intro` and `#whatami`. The terminal reads its
`home` and `whatami` output straight out of that markup, so **edit the markdown
and both the page and the commands update** — there is no second copy in
`src/terminal.js`.

Once the terminal boots it adds `home-terminal` to `<body>`, and the stylesheet
hides those two blocks plus the rules between them. That hiding is triggered by
JavaScript on purpose: with JS off, nothing is hidden and the homepage reads
top to bottom the way it always did. The text also stays in the HTML for link
previews and search results.

`whoami` is an unlisted alias for `home`.

## Generated — don't edit by hand

`demo/musings.generated.md`, `demo/archive.generated.md`, `site-manifest.json`,
and every `index.html` outside `demo/`.

## A warning about `sightseeing/`

The photographs live in `sightseeing/` next to the generated `index.html` and
exist nowhere else. `make clean` deletes only `sightseeing/index.html` for that
reason. Never `rm -rf sightseeing`.
