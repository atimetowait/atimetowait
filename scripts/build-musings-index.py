#!/usr/bin/env python3
"""Generate the musings index, the archive page, and site-manifest.json.

Everything here is derived from the front matter of demo/musings/*.md, so
adding an entry means adding one markdown file and nothing else.

Outputs:
  demo/musings.generated.md  chronological index, grouped by month
  demo/archive.generated.md  dense filterable table of every entry
  site-manifest.json         what the footer terminal knows about
"""

from __future__ import annotations

import html
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRIES_DIR = ROOT / "demo" / "musings"
OUTPUT = ROOT / "demo" / "musings.generated.md"
ARCHIVE_OUTPUT = ROOT / "demo" / "archive.generated.md"
MANIFEST_OUTPUT = ROOT / "site-manifest.json"

# Static (non-journal) sections, for `ls` and `cd` in the terminal.
SECTIONS = [
    {"name": "home", "href": "/", "description": "who i am, and what this is"},
    {"name": "musings", "href": "/musings/", "description": "the writing, newest first"},
    {"name": "sightseeing", "href": "/sightseeing/", "description": "photographs, mostly from before"},
    {"name": "listen", "href": "/listen/", "description": "music, under whichever name"},
    {"name": "bookkeeping", "href": "/bookkeeping/", "description": "a running ledger of small things"},
    {"name": "archive", "href": "/archive/", "description": "everything at once, out of order"},
]

MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


def parse_front_matter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[3:end].strip()
    data: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def parse_tags(raw: str) -> list[str]:
    if not raw:
        return []
    inner = raw.strip()
    if inner.startswith("[") and inner.endswith("]"):
        inner = inner[1:-1]
    if not inner:
        return []
    return [t.strip().strip('"').strip("'") for t in inner.split(",") if t.strip()]


def load_entries() -> list[dict]:
    entries = []
    for path in sorted(ENTRIES_DIR.glob("*.md")):
        if path.name.startswith("_"):
            continue

        meta = parse_front_matter(path.read_text(encoding="utf-8"))
        date_str = meta.get("date", "")

        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        slug = path.stem

        entries.append(
            {
                "date": day,
                "summary": meta.get("summary", slug),
                "title": meta.get("page-title", meta.get("summary", slug)),
                "tags": parse_tags(meta.get("tags", "")),
                "mood": meta.get("mood", "bone"),
                "href": f"/musings/{slug}/",
                "slug": slug,
            }
        )

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


def month_heading(day: datetime.date) -> str:
    return f"{MONTHS[day.month - 1]} {day.year}"


def render_index(entries: list[dict]) -> str:
    lines = [
        "---",
        "title: atimetowait",
        "subtitle: freya langley // aCadogan",
        "lang: en",
        "toc-title: Site Guide",
        "page-title: Musings",
        "---",
        "",
        '<nav class="journal-index" role="navigation">',
    ]

    current_month: str | None = None

    for entry in entries:
        heading = month_heading(entry["date"])

        if heading != current_month:
            if current_month is not None:
                lines.append("</ul>")

            lines.append(f"<h2>{heading}</h2>")
            lines.append("<ul>")
            current_month = heading

        date_label = entry["date"].strftime("%Y-%m-%d")
        title = html.escape(entry["summary"])

        tag_html = ""
        if entry["tags"]:
            tags = " ".join(
                f'<span class="journal-tag">{html.escape(t)}</span>'
                for t in entry["tags"]
            )
            tag_html = f" · {tags}"

        lines.append(
            f'<li data-mood="{html.escape(entry["mood"])}">'
            f'<span class="journal-date">{date_label}</span> · '
            f'<a href="{entry["href"]}">{title}</a>{tag_html}</li>'
        )

    if current_month is not None:
        lines.append("</ul>")

    lines.append("</nav>")
    lines.append("")

    return "\n".join(lines)


def render_archive(entries: list[dict]) -> str:
    """Everything at once, out of order -- filterable by tag and by text."""
    all_tags = sorted({t for e in entries for t in e["tags"]})

    lines = [
        "---",
        "title: atimetowait",
        "subtitle: freya langley // aCadogan",
        "lang: en",
        "toc-title: Site Guide",
        "page-title: Archive",
        "---",
        "",
        '<div class="archive">',
        '<p class="archive-intro">Everything, out of order. '
        f"{len(entries)} entries spanning "
        f"{min(e['date'].year for e in entries)}–{max(e['date'].year for e in entries)}.</p>",
        "",
        '<div class="archive-controls">',
        '<label class="archive-search-label" for="archive-search">search</label>',
        '<input type="search" id="archive-search" class="archive-search" '
        'placeholder="type to filter..." autocomplete="off">',
        '<div class="archive-tags" role="group" aria-label="Filter by tag">',
        '<button type="button" class="archive-tag is-active" data-tag="">all</button>',
    ]

    for tag in all_tags:
        lines.append(
            f'<button type="button" class="archive-tag" data-tag="{html.escape(tag)}">'
            f"{html.escape(tag)}</button>"
        )

    lines += [
        "</div>",
        "</div>",
        "",
        '<p class="archive-count" role="status" aria-live="polite"></p>',
        "",
        '<ul class="archive-list">',
    ]

    for entry in entries:
        date_label = entry["date"].strftime("%Y-%m-%d")
        haystack = " ".join(
            [entry["summary"], entry["title"], entry["slug"], *entry["tags"]]
        ).lower()

        tag_html = "".join(
            f'<span class="journal-tag">{html.escape(t)}</span>' for t in entry["tags"]
        )

        lines.append(
            f'<li class="archive-row" data-mood="{html.escape(entry["mood"])}" '
            f'data-tags="{html.escape("|".join(entry["tags"]))}" '
            f'data-search="{html.escape(haystack)}">'
            f'<span class="archive-date">{date_label}</span>'
            f'<span class="archive-title"><a href="{entry["href"]}">'
            f'{html.escape(entry["summary"])}</a></span>'
            f'<span class="archive-meta">{tag_html}</span>'
            f"</li>"
        )

    lines += [
        "</ul>",
        '<p class="archive-empty" hidden>nothing here matches that.</p>',
        "</div>",
        "",
    ]

    return "\n".join(lines)


def render_manifest(entries: list[dict]) -> str:
    """What the footer terminal knows about."""
    return json.dumps(
        {
            "generated": datetime.now().strftime("%Y-%m-%d"),
            "sections": SECTIONS,
            "entries": [
                {
                    "slug": e["slug"],
                    "title": e["title"],
                    "summary": e["summary"],
                    "date": e["date"].strftime("%Y-%m-%d"),
                    "tags": e["tags"],
                    "mood": e["mood"],
                    "href": e["href"],
                }
                for e in entries
            ],
        },
        indent=2,
    ) + "\n"


def main() -> None:
    entries = load_entries()

    OUTPUT.write_text(render_index(entries), encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(entries)} entries)")

    if entries:
        ARCHIVE_OUTPUT.write_text(render_archive(entries), encoding="utf-8")
        print(f"Wrote {ARCHIVE_OUTPUT}")

    MANIFEST_OUTPUT.write_text(render_manifest(entries), encoding="utf-8")
    print(f"Wrote {MANIFEST_OUTPUT}")


if __name__ == "__main__":
    main()