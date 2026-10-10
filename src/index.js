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

/**
 * Re-measuring on resize is right, but binding it straight to the event is not
 * affordable on a phone: scrolling shows and hides the URL bar, which fires
 * `resize` repeatedly *during* the scroll. Each one made adjustMediaPadding
 * read every image's rect and then write a style back, i.e. a forced layout per
 * image per event, on the one thread that is already trying to scroll.
 *
 * Width is also the only dimension the function uses -- it derives height from
 * `rect.width / ratio`. A URL bar appearing changes only the height, so the
 * common mobile case needs no work at all and is dropped outright.
 */
let lastViewportWidth = window.innerWidth;
let mediaPaddingTimer = null;

window.addEventListener("resize", () => {
  if (window.innerWidth === lastViewportWidth) return;
  lastViewportWidth = window.innerWidth;

  clearTimeout(mediaPaddingTimer);
  mediaPaddingTimer = setTimeout(adjustMediaPadding, 150);
});

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

    const scramble = () => {
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
    };

    span.addEventListener("mouseenter", scramble);
    // mouseenter alone meant the effect simply did not exist on a phone -- there
    // is no hover to enter with. pointerdown is the touch equivalent of the same
    // gesture: reach for the word, the word misbehaves. Binding both is safe
    // because scramble() is idempotent while running (the `frame !== null`
    // guard), so a mouse press mid-animation is swallowed and one after it has
    // settled simply replays it, which is no worse than hovering twice. Not
    // `click`, so it fires on contact rather than after the tap resolves.
    span.addEventListener("pointerdown", scramble);
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

/**
 * THE BACKDROP, AT FULL RESOLUTION
 *
 * Each piece of art ships twice (scripts/build-header-art.py --downsample): a
 * half-scale grid, which is what the page has inlined, and a full-resolution
 * sibling named on the wrapper as data-art-hires.
 *
 * The coarse one is inlined deliberately. At 440 columns across a phone a glyph
 * renders near 2.4px and the drawing stops resolving as characters at all, so
 * the detail is unbuyable there at any price -- while the 6-14k extra DOM nodes
 * are very much payable. Half scale doubles the rendered glyph and costs 61-74%
 * fewer nodes, including the animated subset, which is the paint cost.
 *
 * So this runs only where the detail can actually be seen, and the test lives in
 * the stylesheet (--art-detail, see IS THE DETAIL WORTH FETCHING? in
 * src/index.css) rather than as a matchMedia string duplicated here and in
 * src/header-art.js.
 *
 * On a phone this function reaches `return` without touching anything, which
 * keeps the backdrop pages' standing promise intact: no JavaScript runs on them,
 * exactly where that promise is worth the most. The hero's own upgrade is
 * separate and lives in src/header-art.js -- it has to be sequenced before the
 * cell grid is built, where this one is fire-and-forget.
 */
function initBackdropDetail() {
  const wrap = document.querySelector(".art-backdrop[data-art-hires]");
  if (!wrap) return;

  // display:none covers `art off` and the prefers-contrast / reduced-transparency
  // floors. Fetching detail for a layer that will never paint is the one case
  // worse than not fetching it at all.
  const style = getComputedStyle(wrap);
  if (style.display === "none") return;
  if (style.getPropertyValue("--art-detail").trim() !== "1") return;

  // Save-Data is a reader explicitly asking for less. The art is decorative and
  // the coarse version is already on screen, so this is exactly the sort of
  // request that should be skipped rather than merely deferred.
  if (navigator.connection && navigator.connection.saveData) return;

  const pre = wrap.querySelector(".header-art");
  if (!pre) return;

  fetch(wrap.dataset.artHires)
    .then((response) => (response.ok ? response.text() : Promise.reject()))
    .then((markup) => {
      // Parsed in a detached document, so the thousands of spans are built once
      // and swapped in as a single subtree rather than being style-resolved
      // mid-construction.
      const next = new DOMParser()
        .parseFromString(markup, "text/html")
        .querySelector(".header-art");
      if (!next) return;

      pre.replaceWith(next);
      // The hi-res file carries no data-art-hires of its own, but clear the
      // pointer anyway: nothing should be able to run this twice.
      delete wrap.dataset.artHires;
    })
    .catch(() => {
      // The half-scale art is already painted and correct. A failed upgrade is
      // not a failure.
    });
}

initBackdropDetail();

/**
 * IN-APP BROWSERS: MAKE THE BACKDROP ACTUALLY COVER
 *
 * Instagram's (and Facebook's) in-app browser leaves the backdrop short: the
 * art lands at roughly 80% of the screen's height, centred, with bare page
 * above and below. Its viewport units and fixed-layer geometry do not agree
 * with what it paints, so no unit in the stylesheet can be trusted there.
 *
 * So for those browsers only -- matched on the user agent, which is the one
 * thing that identifies them -- measure the art after layout and scale it up by
 * exactly the shortfall, through --art-boost (see .art-backdrop .header-art in
 * src/index.css). It checks against every height the browser offers and takes
 * the largest, and re-runs on resize, so it can only ever over-cover. Every
 * other browser returns at the first line and keeps the page's no-JS promise.
 */
function initInAppBackdropFit() {
  if (!/Instagram|FBAN|FBAV|FB_IAB/i.test(navigator.userAgent)) return;

  const wrap = document.querySelector(".art-backdrop");
  if (!wrap) return;

  const fit = () => {
    const pre = wrap.querySelector(".header-art");
    if (!pre) return;

    const vv = window.visualViewport;
    const need = Math.max(
      window.innerHeight,
      vv ? vv.height : 0,
      document.documentElement.clientHeight,
      wrap.clientHeight
    );
    const needW = Math.max(
      window.innerWidth,
      vv ? vv.width : 0,
      document.documentElement.clientWidth,
      wrap.clientWidth
    );

    // Measure at the current boost and correct from there, so repeated runs
    // converge instead of compounding.
    const current = parseFloat(wrap.style.getPropertyValue("--art-boost")) || 1;
    const box = pre.getBoundingClientRect();
    const shortfall = Math.max(need / box.height, needW / box.width);
    // Already covering: leave it. Never shrinks, so repeated runs settle.
    if (!isFinite(shortfall) || shortfall <= 1) return;

    const next = Math.max(1, current * shortfall * 1.02);
    wrap.style.setProperty("--art-boost", next.toFixed(3));
  };

  fit();
  window.addEventListener("load", fit);
  window.addEventListener("resize", fit);
}

initInAppBackdropFit();
