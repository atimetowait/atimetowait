#!/usr/bin/env python3
"""Build the blog: a stream of short entries, grouped by day.

One file per day, demo/blog/YYYY-MM-DD.md. Inside it, each `@HH:MM` line on its
own starts an entry, and everything up to the next one is that entry's markdown.
Entries within a day read oldest to newest, like a log; days run newest first.
Whatever order the entries were appended in, they are sorted by their time.

The format is deliberately append-friendly: posting is adding `@HH:MM`, a line,
and the text to the end of today's file (creating it if need be). Anything that
can do that -- a bot, a mail handler, you in an editor -- can publish.

Outputs:
  blog/index.html             every day, newest first
  blog/YYYY-MM-DD/index.html  one day on its own, for linking
  blog/feed.xml               an Atom feed, one item per entry
"""

from __future__ import annotations

import html
import re
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "demo" / "blog"
OUT = ROOT / "blog"
TEMPLATE = (ROOT / "demo" / "blog-template.html").read_text(encoding="utf-8")
SITE = "https://atimetowait.com"
BLURB = "everything is matched with its hexadecimal translation, dont know what it means though"

STAMP = re.compile(r"^@(\d{1,2}):(\d{2})[ \t]*$", re.MULTILINE)


def markdown(text: str) -> str:
    """One entry's markdown as an HTML fragment.

    raw_html is off on purpose: entries can arrive from a bot, so a line of
    <script> must come out as text, not run on the page.
    """
    return subprocess.run(
        ["pandoc", "-f", "markdown-raw_html", "-t", "html"],
        input=text, capture_output=True, text=True, check=True,
    ).stdout


def load_days() -> list[dict]:
    days = []
    for path in POSTS_DIR.glob("*.md"):
        try:
            date = datetime.strptime(path.stem, "%Y-%m-%d").date()
        except ValueError:
            continue  # _notes.md and the like
        text = path.read_text(encoding="utf-8")
        parts = STAMP.split(text)
        # split() with two groups yields: preamble, h, m, body, h, m, body, ...
        entries = []
        for i in range(1, len(parts) - 2, 3):
            hh, mm, body = int(parts[i]), int(parts[i + 1]), parts[i + 2].strip()
            if body:
                entries.append({"time": f"{hh:02d}:{mm:02d}", "body": body})
        entries.sort(key=lambda e: e["time"])  # stable: same minute keeps file order
        if entries:
            days.append({"date": date, "entries": entries})
    return sorted(days, key=lambda d: d["date"], reverse=True)


def render_day(day: dict, link_heading: bool) -> str:
    date = day["date"]
    heading = f'<a href="/blog/{date}/">{date}</a>' if link_heading else str(date)
    out = [f'<section class="day" id="{date}">', f"<h2>{heading}</h2>"]
    for e in day["entries"]:
        anchor = e["time"].replace(":", "")
        out.append(
            f'<div class="entry" id="{date}-{anchor}">'
            f'<span class="time"><a href="/blog/{date}/#{date}-{anchor}">{e["time"]}</a></span>'
            f"{markdown(e['body'])}</div>"
        )
    out.append("</section>")
    return "\n".join(out)


def page(title: str, og_title: str, description: str, body: str) -> str:
    esc = html.escape
    return (
        TEMPLATE.replace("@@TITLE@@", esc(title))
        .replace("@@OGTITLE@@", esc(og_title))
        .replace("@@DESCRIPTION@@", esc(description, quote=True))
        .replace("@@BODY@@", body)
    )


def render_feed(days: list[dict]) -> str:
    items, latest = [], "1970-01-01T00:00:00Z"
    for d in days:
        for e in reversed(d["entries"]):
            stamp = f'{d["date"]}T{e["time"]}:00Z'
            latest = max(latest, stamp)
            anchor = e["time"].replace(":", "")
            link = f'{SITE}/blog/{d["date"]}/#{d["date"]}-{anchor}'
            items.append(
                f"  <entry>\n    <title>{d['date']} {e['time']}</title>\n"
                f'    <link href="{link}"/>\n    <id>{link}</id>\n'
                f"    <updated>{stamp}</updated>\n"
                f'    <content type="html">{html.escape(markdown(e["body"]))}</content>\n'
                "  </entry>\n"
            )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        "  <title>blog</title>\n"
        f'  <link href="{SITE}/blog/"/>\n'
        f'  <link rel="self" href="{SITE}/blog/feed.xml"/>\n'
        f"  <id>{SITE}/blog/</id>\n"
        f"  <updated>{latest}</updated>\n"
        "  <author><name>freya langley // aCadogan</name></author>\n"
        + "".join(items)
        + "</feed>\n"
    )


def main() -> None:
    days = load_days()
    OUT.mkdir(exist_ok=True)

    intro = (
        f"<header>\n<h1>blog</h1>\n<p>{BLURB}</p>\n</header>\n"
        '<ul>\n  <li><a href="/">back to atimetowait.com</a></li>\n'
        '  <li><a href="/blog/feed.xml">rss</a></li>\n</ul>\n'
    )
    stream = "\n".join(render_day(d, True) for d in days) or "<p>nothing here yet.</p>"
    (OUT / "index.html").write_text(
        page("blog – atimetowait", "blog", BLURB, intro + stream), encoding="utf-8"
    )

    for d in days:
        folder = OUT / str(d["date"])
        folder.mkdir(exist_ok=True)
        body = '<a href="/blog/">..</a>\n' + render_day(d, False)
        first = re.sub(r"\s+", " ", d["entries"][0]["body"])[:140]
        (folder / "index.html").write_text(
            page(f'{d["date"]} – blog – atimetowait', f'blog · {d["date"]}', first, body),
            encoding="utf-8",
        )

    (OUT / "feed.xml").write_text(render_feed(days), encoding="utf-8")
    print(f"blog: {sum(len(d['entries']) for d in days)} entries over {len(days)} day(s)")


if __name__ == "__main__":
    main()
