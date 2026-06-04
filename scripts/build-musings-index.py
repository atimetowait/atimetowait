#!/usr/bin/env python3
"""Generate demo/musings.generated.md index from demo/musings/*.md entries."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRIES_DIR = ROOT / "demo" / "musings"
OUTPUT = ROOT / "demo" / "musings.generated.md"

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
                "tags": parse_tags(meta.get("tags", "")),
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
        title = entry["summary"]

        tag_html = ""
        if entry["tags"]:
            tags = " ".join(
                f'<span class="journal-tag">{t}</span>'
                for t in entry["tags"]
            )
            tag_html = f" · {tags}"

        lines.append(
            f'<li><span class="journal-date">{date_label}</span> · '
            f'<a href="{entry["href"]}">{title}</a>{tag_html}</li>'
        )

    if current_month is not None:
        lines.append("</ul>")

    lines.append("</nav>")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    entries = load_entries()
    OUTPUT.write_text(render_index(entries), encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(entries)} entries)")


if __name__ == "__main__":
    main()