function gridCellDimensions() {
  const element = document.createElement("div");
  element.style.position = "fixed";
  element.style.height = "var(--line-height)";
  element.style.width = "1ch";
  document.body.appendChild(element);
  const rect = element.getBoundingClientRect();
  document.body.removeChild(element);
  return { width: rect.width, height: rect.height };
}

// Add padding to each media to maintain grid.
function adjustMediaPadding() {
  const cell = gridCellDimensions();

  function setHeightFromRatio(media, ratio) {
      const rect = media.getBoundingClientRect();
      const realHeight = rect.width / ratio;
      const diff = cell.height - (realHeight % cell.height);
      media.style.setProperty("padding-bottom", `${diff}px`);
  }

  function setFallbackHeight(media) {
      const rect = media.getBoundingClientRect();
      const height = Math.round((rect.width / 2) / cell.height) * cell.height;
      media.style.setProperty("height", `${height}px`);
  }

  function onMediaLoaded(media) {
    var width, height;
    switch (media.tagName) {
      case "IMG":
        width = media.naturalWidth;
        height = media.naturalHeight;
        break;
      case "VIDEO":
        width = media.videoWidth;
        height = media.videoHeight;
        break;
    }
    if (width > 0 && height > 0) {
      setHeightFromRatio(media, width / height);
    } else {
      setFallbackHeight(media);
    }
  }

  const medias = document.querySelectorAll("img, video");
  for (const media of medias) {
    switch (media.tagName) {
      case "IMG":
        if (media.complete) {
          onMediaLoaded(media);
        } else {
          media.addEventListener("load", () => onMediaLoaded(media));
          media.addEventListener("error", function() {
              setFallbackHeight(media);
          });
        }
        break;
      case "VIDEO":
        switch (media.readyState) {
          case HTMLMediaElement.HAVE_CURRENT_DATA:
          case HTMLMediaElement.HAVE_FUTURE_DATA:
          case HTMLMediaElement.HAVE_ENOUGH_DATA:
            onMediaLoaded(media);
            break;
          default:
            media.addEventListener("loadeddata", () => onMediaLoaded(media));
            media.addEventListener("error", function() {
              setFallbackHeight(media);
            });
            break;
        }
        break;
    }
  }
}

adjustMediaPadding();
window.addEventListener("load", adjustMediaPadding);
window.addEventListener("resize", adjustMediaPadding);

function openExternalLinksInNewTab() {
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) {
      continue;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
}

openExternalLinksInNewTab();

function checkOffsets() {
  const ignoredTagNames = new Set([
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "TD",
    "TH",
  ]);
  const cell = gridCellDimensions();
  const elements = document.querySelectorAll("body :not(.debug-grid, .debug-toggle)");
  for (const element of elements) {
    if (ignoredTagNames.has(element.tagName)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }
    const top = rect.top + window.scrollY;
    const left = rect.left + window.scrollX;
    const offset = top % (cell.height / 2);
    if(offset > 0) {
      element.classList.add("off-grid");
      console.error("Incorrect vertical offset for", element, "with remainder", top % cell.height, "when expecting divisible by", cell.height / 2);
    } else {
      element.classList.remove("off-grid");
    }
  }
}

// The debug toggle is optional: it only exists on pages that opt into the
// grid overlay. Bail out quietly when it isn't present.
const debugToggle = document.querySelector(".debug-toggle");
if (debugToggle) {
  const onDebugToggle = () => {
    document.body.classList.toggle("debug", debugToggle.checked);
  };
  debugToggle.addEventListener("change", onDebugToggle);
  onDebugToggle();
}

/**
 * TEXT THAT MISBEHAVES
 *
 * Two effects, both purely additive: if the JS never runs, or the reader has
 * asked for reduced motion, every word stays exactly where it is and fully
 * legible. Nothing here is load-bearing for reading the site.
 */
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Glitch on hover. Author-marked only, via Pandoc bracketed spans:
 *   [in perptuality, a drift]{.glitch}
 */
function initGlitch() {
  const POOL = "!@#$%&*<>/\\|_-=+~^abcdefghijklmnopqrstuvwxyz0123456789";
  const DURATION = 420;

  for (const span of document.querySelectorAll(".glitch")) {
    const original = span.textContent;
    let frame = null;

    span.addEventListener("mouseenter", () => {
      if (prefersReducedMotion.matches || frame !== null) return;

      const started = performance.now();

      const tick = (now) => {
        const progress = Math.min(1, (now - started) / DURATION);

        // Characters settle back left-to-right as progress advances.
        const settled = Math.floor(progress * original.length);
        let next = "";
        for (let i = 0; i < original.length; i += 1) {
          const char = original[i];
          if (i < settled || char === " " || Math.random() > 0.35) {
            next += char;
          } else {
            next += POOL[Math.floor(Math.random() * POOL.length)];
          }
        }
        span.textContent = next;

        if (progress < 1) {
          frame = requestAnimationFrame(tick);
        } else {
          span.textContent = original;
          frame = null;
        }
      };

      frame = requestAnimationFrame(tick);
    });
  }
}

/**
 * Line-by-line reveal inside journal entries.
 *
 * Entries are built with markdown+hard_line_breaks, so lines are separated by
 * bare <br> with nothing to observe. Wrap each run of nodes between <br>s in a
 * span first, then hand those spans to an IntersectionObserver.
 */
function initLineReveal() {
  const entry = document.querySelector(".journal-entry");
  if (!entry || entry.classList.contains("no-reveal") || prefersReducedMotion.matches) return;
  if (!("IntersectionObserver" in window)) return;

  const lines = [];

  for (const block of entry.querySelectorAll("p")) {
    const runs = [];
    let current = [];

    for (const node of Array.from(block.childNodes)) {
      if (node.nodeName === "BR") {
        // Keep the <br> itself outside the wrapper so the existing
        // `br + br` spacing rules still see adjacent siblings.
        if (current.length) runs.push(current);
        current = [];
      } else {
        current.push(node);
      }
    }
    if (current.length) runs.push(current);

    // A block with no <br> at all is a single line; wrapping it is still fine.
    for (const run of runs) {
      const hasText = run.some((n) => n.textContent.trim().length);
      if (!hasText) continue;

      const span = document.createElement("span");
      span.className = "line";
      run[0].parentNode.insertBefore(span, run[0]);
      for (const node of run) span.appendChild(node);
      lines.push(span);
    }
  }

  if (!lines.length) return;

  // Only hide the lines once we know we can reveal them again.
  entry.classList.add("reveal-armed");

  // The very last line has nothing after it to build anticipation for, and
  // it's the one line where "wait until scroll says it's time" is actually
  // fragile: it sits closest to the end of the page, where there's the least
  // room left to scroll, and on a short entry the whole piece can already
  // fit on screen with nothing to scroll at all. Chasing that with scroll/
  // resize/font-load listeners (tried first) just traded one race for
  // several -- simpler and actually reliable is to never hide it at all.
  const last = lines.pop();
  last.classList.add("is-visible");

  if (!lines.length) return;

  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) {
          record.target.classList.add("is-visible");
          observer.unobserve(record.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 }
  );

  for (const line of lines) observer.observe(line);
}

initGlitch();
initLineReveal();

/**
 * ARCHIVE FILTERING
 *
 * Progressive enhancement: without JS the archive still renders every entry as
 * a plain list of links. The controls simply do nothing.
 */
function initArchive() {
  const archive = document.querySelector(".archive");
  if (!archive) return;

  const search = archive.querySelector(".archive-search");
  const rows = Array.from(archive.querySelectorAll(".archive-row"));
  const tagButtons = Array.from(archive.querySelectorAll(".archive-tag"));
  const count = archive.querySelector(".archive-count");
  const empty = archive.querySelector(".archive-empty");

  let activeTag = "";

  function apply() {
    const term = (search ? search.value : "").trim().toLowerCase();
    let shown = 0;

    for (const row of rows) {
      const tags = (row.dataset.tags || "").split("|");
      const matchesTag = !activeTag || tags.includes(activeTag);
      const matchesTerm = !term || (row.dataset.search || "").includes(term);
      const visible = matchesTag && matchesTerm;

      row.hidden = !visible;
      if (visible) shown += 1;
    }

    if (count) {
      count.textContent =
        shown === rows.length
          ? `${rows.length} entries`
          : `${shown} of ${rows.length}`;
    }
    if (empty) empty.hidden = shown !== 0;
  }

  if (search) search.addEventListener("input", apply);

  for (const button of tagButtons) {
    button.addEventListener("click", () => {
      activeTag = button.dataset.tag || "";
      for (const other of tagButtons) {
        other.classList.toggle("is-active", other === button);
      }
      apply();
    });
  }

  apply();
}

initArchive();
