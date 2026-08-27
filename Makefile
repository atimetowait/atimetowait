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
ART_HTML=$(patsubst demo/art/%.txt,demo/art/%.generated.html,$(ART_SOURCES))

# art_flag,<name> -> the --include-before-body flag for demo/art/<name>.txt, or
# nothing if that page has no art yet. --include-before-body, not a -V variable, so
# pandoc never parses the art's backslashes, $$, {} and ~ (same reasoning as the
# homepage's art below).
art_flag = $(if $(wildcard demo/art/$(1).txt),--include-before-body=demo/art/$(1).generated.html)

all: $(HTML_PAGES) $(JOURNAL_HTML)

# Remove only generated files. NEVER `rm -rf sightseeing` -- the photographs
# live in that directory alongside the generated index.html and are not
# reproducible from source.
clean:
	rm -f index.html demo/musings.generated.md demo/archive.generated.md site-manifest.json
	rm -f demo/header-art.generated.html
	rm -f demo/art/*.generated.html
	rm -f sightseeing/index.html
	rm -rf musings bookkeeping listen archive

# One script produces the musings index, the archive page and the terminal's
# manifest; they share the same front-matter parse.
demo/musings.generated.md demo/archive.generated.md site-manifest.json &: $(JOURNAL_ENTRIES) scripts/build-musings-index.py
	python3 scripts/build-musings-index.py

# --include-before-body inserts the file verbatim: no template interpolation and no
# markdown parsing, so the art's backslashes, $$, {} and ~ survive untouched.
index.html: demo/index.md demo/template.html demo/header-art.generated.html Makefile
	$(PANDOC) --include-before-body=demo/header-art.generated.html -i demo/index.md -o $@

demo/header-art.generated.html: demo/header-art.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py

# Any piece of art regenerates as demo/art/<name>.generated.html, with --class
# art-backdrop so it gets the faint, margin-only treatment instead of the
# homepage's full-bleed hero.
#
# Per-piece flare: most art leaves this at the --flare default (1) via
# FLARE_<name> being unset. Set one below to make a specific piece's cells
# blink and twinkle more often than the site default -- see --flare's help
# in scripts/build-header-art.py.
FLARE_myownkin=1.6

demo/art/%.generated.html: demo/art/%.txt scripts/build-header-art.py
	python3 scripts/build-header-art.py --source $< --output $@ --class art-backdrop $(if $(FLARE_$*),--flare=$(FLARE_$*))

musings/index.html: demo/musings.generated.md demo/template.html Makefile $(ART_HTML)
	mkdir -p musings
	$(PANDOC) $(call art_flag,musings) -i demo/musings.generated.md -o $@

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
	$(JOURNAL_PANDOC) $(call art_flag,$*) -i demo/musings/$*.md -o $@

serve: all
	live-server --open=/ --host=127.0.0.1 .

watch:
	printf '%s\n' demo/index.md demo/bookkeeping.md demo/sightseeing.md demo/listen.md demo/template.html demo/musings.generated.md demo/archive.generated.md demo/header-art.txt demo/art/*.txt Makefile scripts/build-musings-index.py scripts/build-header-art.py | entr -n make
	find demo/musings -name '*.md' -print 2>/dev/null | entr -n make

.PHONY: all clean serve watch