VERSION=$(shell jq -r .version package.json)
DATE=$(shell date +%F)

PANDOC=pandoc -s --css /src/reset.css --css /src/index.css \
	-Vversion=v$(VERSION) -Vdate=$(DATE) \
	--template=demo/template.html

JOURNAL_PANDOC=$(PANDOC) -f markdown+hard_line_breaks

HTML_PAGES=index.html \
	musings/index.html \
	bookkeeping/index.html \
	sightseeing/index.html \
	listen/index.html \
	archive/index.html

JOURNAL_ENTRIES=$(filter-out demo/musings/_%.md,$(wildcard demo/musings/*.md))
JOURNAL_HTML=$(patsubst demo/musings/%.md,musings/%/index.html,$(JOURNAL_ENTRIES))

# Per-page backdrop art. Opt-in by file existence: drop demo/art/<name>.txt for a
# section page, or demo/art/<slug>.txt for a journal entry, and a rebuild picks it up
# automatically -- nothing to wire per page. The homepage's own full-bleed art is a
# separate, older path (demo/header-art.txt) and isn't part of this list.
ART_SOURCES=$(wildcard demo/art/*.txt)

# Every piece is built twice, at two resolutions. At 220 columns across a phone a
# glyph is ~1.8px, which is past the point where the drawing resolves as characters
# at all -- so the phone gets a half-scale grid (61-74% fewer DOM nodes, and it
# actually reads better at that size), and anything wide enough to see the detail
# upgrades to the full-resolution file afterwards. See --downsample and --hires in
# scripts/build-header-art.py.
#
# The coarse one is the variant INLINED into the page: the constrained client
# should not have to wait on a second request, and the one with bandwidth to spare
# is the one that can afford to fetch an upgrade.
ART_HTML=$(patsubst demo/art/%.txt,demo/art/%.generated.html,$(ART_SOURCES)) \
	$(patsubst demo/art/%.txt,demo/art/%.m.generated.html,$(ART_SOURCES))

# art_flag,<name> -> the --include-before-body flag for demo/art/<name>.txt, or
# nothing if that page has no art yet. --include-before-body, not a -V variable, so
# pandoc never parses the art's backslashes, $$, {} and ~ (same reasoning as the
# homepage's art below).
art_flag = $(if $(wildcard demo/art/$(1).txt),--include-before-body=demo/art/$(1).m.generated.html)

all: $(HTML_PAGES) $(JOURNAL_HTML)

# The typeface, subset and served from this origin instead of @import-ed from a
# CDN (see THE TYPEFACE in src/index.css). Deliberately NOT a prerequisite of
# `all`: the outputs are committed, and building them needs both fonttools and a
# system copy of JetBrains Mono, neither of which the site should require of
# whoever is only editing prose. Run it by hand after changing FACES or
# UNICODES in the script.
fonts:
	python3 scripts/build-fonts.py

# Remove only generated files. NEVER `rm -rf sightseeing` -- the photographs
# live in that directory alongside the generated index.html and are not
# reproducible from source.
clean:
	rm -f index.html demo/musings.generated.md demo/archive.generated.md site-manifest.json
	rm -f demo/header-art.generated.html demo/header-art.m.generated.html
	rm -f demo/art/*.generated.html
	rm -f sightseeing/index.html
	rm -rf musings bookkeeping listen archive

# One script produces the musings index, the archive page and the terminal's
# manifest; they share the same front-matter parse.
demo/musings.generated.md demo/archive.generated.md site-manifest.json &: $(JOURNAL_ENTRIES) scripts/build-musings-index.py
	python3 scripts/build-musings-index.py

# --include-before-body inserts the file verbatim: no template interpolation and no
# markdown parsing, so the art's backslashes, $$, {} and ~ survive untouched.
index.html: demo/index.md demo/template.html demo/header-art.m.generated.html demo/header-art.generated.html Makefile
	$(PANDOC) --include-before-body=demo/header-art.m.generated.html -i demo/index.md -o $@

demo/header-art.generated.html: demo/header-art.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py

# The hero's phone variant. Still one span per character, unlike the backdrops --
# src/header-art.js addresses cells as row*COLS+col to melt them under a finger, so
# they have to stay individually addressable. Half scale just means it does that
# over 2,640 of them instead of 10,340.
demo/header-art.m.generated.html: demo/header-art.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py --output $@ --downsample 2 \
		--hires /demo/header-art.generated.html

# Any piece of art regenerates as demo/art/<name>.generated.html, with --class
# art-backdrop so it gets the faint, margin-only treatment instead of the
# homepage's full-bleed hero.
#
# Per-piece flare: most art leaves this at the --flare default (1) via
# FLARE_<name> being unset. Set one below to make a specific piece livelier --
# it scales how many of that piece's cells are tagged (at build time) for the
# CSS twinkle and red blink, so it costs nothing at runtime. See --flare's help
# in scripts/build-header-art.py.
FLARE_myownkin=1.6

# Per-piece tone tiers: most art leaves this at the --tiers default (8) via
# TIERS_<name> being unset. spiritual_instability's detail is genuinely
# dithered rather than mostly-flat-fill like the others, so run-merging alone
# only got it to ~59% fewer spans against their 86-94%. Measured at real size
# (5-9px, ~34% opacity, masked): tiers=3 is visually indistinguishable from
# the default 8 -- confirmed by diffing screenshots, not eyeballing a shrunk
# thumbnail, which is misleading here -- while cutting spans a further 50%,
# 26,995 -> 13,334, in line with the other four pieces. See --tiers's help in
# scripts/build-header-art.py.
TIERS_spiritual_instability=3

demo/art/%.generated.html: demo/art/%.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py --source $< --output $@ --class art-backdrop $(if $(FLARE_$*),--flare=$(FLARE_$*)) $(if $(TIERS_$*),--tiers=$(TIERS_$*))

# The phone variant of the same piece. Listed before the rule above is irrelevant to
# make -- it picks by stem length, and `mercurial` is shorter than `mercurial.m` --
# but the two cannot be collapsed into one rule, because `%.generated.html` would
# otherwise match `mercurial.m.generated.html` and go looking for a
# `demo/art/mercurial.m.txt` that does not exist.
#
# Note the per-piece TIERS_ override still applies: tone tiers and resolution are
# independent levers, and spiritual_instability needs both.
demo/art/%.m.generated.html: demo/art/%.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py --source $< --output $@ --class art-backdrop --downsample 2 \
		--hires /demo/art/$*.generated.html $(if $(FLARE_$*),--flare=$(FLARE_$*)) $(if $(TIERS_$*),--tiers=$(TIERS_$*))

musings/index.html: demo/musings.generated.md demo/template.html Makefile $(ART_HTML)
	mkdir -p musings
	$(PANDOC) $(call art_flag,musings) -Vbodyclass=musings-index -i demo/musings.generated.md -o $@

bookkeeping/index.html: demo/bookkeeping.md demo/template.html Makefile $(ART_HTML)
	mkdir -p bookkeeping
	$(PANDOC) $(call art_flag,bookkeeping) -i demo/bookkeeping.md -o $@

sightseeing/index.html: demo/sightseeing.md demo/template.html Makefile $(ART_HTML)
	mkdir -p sightseeing
	$(PANDOC) $(call art_flag,sightseeing) -i demo/sightseeing.md -o $@

listen/index.html: demo/listen.md demo/template.html Makefile $(ART_HTML)
	mkdir -p listen
	$(PANDOC) $(call art_flag,listen) -i demo/listen.md -o $@

archive/index.html: demo/archive.generated.md demo/template.html Makefile $(ART_HTML)
	mkdir -p archive
	$(PANDOC) $(call art_flag,archive) -i demo/archive.generated.md -o $@

musings/%/index.html: demo/musings/%.md demo/template.html Makefile $(ART_HTML)
	mkdir -p musings/$*
	$(JOURNAL_PANDOC) $(call art_flag,$*) -Vbodyclass=journal-entry-page -i demo/musings/$*.md -o $@

# live-server (flake.nix's devShell) gives live-reload on file change. Where
# it isn't on PATH -- no Nix/direnv, e.g. this sandbox -- fall back to
# scripts/dev-server.py, which reimplements entr + live-server's rebuild-and-
# reload loop with nothing but the standard library. PORT is overridable
# (`make serve PORT=9000`); dev-server.py defaults to the same 8000.
PORT ?= 8000

serve: all
	@if command -v live-server >/dev/null 2>&1; then \
		live-server --open=/ --host=127.0.0.1 .; \
	else \
		echo "live-server not found on PATH (see flake.nix) -- using scripts/dev-server.py instead (same live-reload behaviour, no install needed)."; \
		python3 scripts/dev-server.py --port $(PORT); \
	fi

watch:
	printf '%s\n' demo/index.md demo/bookkeeping.md demo/sightseeing.md demo/listen.md demo/template.html demo/musings.generated.md demo/archive.generated.md demo/header-art.txt demo/art/*.txt Makefile scripts/build-musings-index.py scripts/build-header-art.py | entr -n make
	find demo/musings -name '*.md' -print 2>/dev/null | entr -n make

.PHONY: all clean serve watch fonts