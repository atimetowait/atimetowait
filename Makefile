VERSION=$(shell jq -r .version package.json)
DATE=$(shell date +%F)

PANDOC=pandoc -s --css /src/reset.css --css /src/index.css \
	-Vversion=v$(VERSION) -Vdate=$(DATE) \
	--template=demo/template.html

HTML_PAGES=index.html \
	musings/index.html \
	bookkeeping/index.html \
	sightseeing/index.html

JOURNAL_ENTRIES=$(filter-out demo/musings/_%.md,$(wildcard demo/musings/*.md))
JOURNAL_HTML=$(patsubst demo/musings/%.md,musings/%/index.html,$(JOURNAL_ENTRIES))

all: $(HTML_PAGES) $(JOURNAL_HTML)

clean:
	rm -f index.html demo/musings.generated.md
	rm -rf musings sightseeing bookkeeping

demo/musings.generated.md: $(JOURNAL_ENTRIES) scripts/build-musings-index.py
	python3 scripts/build-musings-index.py

index.html: demo/index.md demo/template.html Makefile
	$(PANDOC) -i demo/index.md -o $@

musings/index.html: demo/musings.generated.md demo/template.html Makefile
	mkdir -p musings
	$(PANDOC) -i demo/musings.generated.md -o $@

bookkeeping/index.html: demo/bookkeeping.md demo/template.html Makefile
	mkdir -p bookkeeping
	$(PANDOC) -i demo/bookkeeping.md -o $@

sightseeing/index.html: demo/sightseeing.md demo/template.html Makefile
	mkdir -p sightseeing
	$(PANDOC) -i demo/sightseeing.md -o $@

musings/%/index.html: demo/musings/%.md demo/template.html Makefile
	mkdir -p musings/$*
	$(PANDOC) -i demo/musings/$*.md -o $@

serve: all
	live-server --open=/ --host=127.0.0.1 .

watch:
	printf '%s\n' demo/index.md demo/bookkeeping.md demo/sightseeing.md demo/template.html demo/musings.generated.md Makefile scripts/build-musings-index.py | entr -n make
	find demo/musings -name '*.md' -print 2>/dev/null | entr -n make

.PHONY: all clean serve watch