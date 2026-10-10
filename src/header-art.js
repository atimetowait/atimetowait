/**
 * The homepage ASCII art, made reactive.
 *
 * The art ships as real text (scripts/build-header-art.py), so every character is
 * an addressable cell rather than a pixel. This module composites three effects
 * over that grid:
 *
 *   boot    the art types itself in, once, when it first scrolls into view
 *   melt    characters near the pointer swap along the density ramp
 *   tear    fast scrolling shears rows sideways, like tracking error
 *
 * plus a slow noise field that decides which cells lean toward the source art's
 * red, so the colour never sits still.
 *
 * Everything here is additive. With JS off the <pre> is already the finished art,
 * and under prefers-reduced-motion it renders complete and static.
 */
(function () {
  "use strict";

  var pre = document.querySelector(".header-art");
  if (!pre) return;

  // CSS already hides the whole wrap for `art off` and for prefers-contrast /
  // reduced-transparency (see [data-art="off"] in index.css). Building the grid
  // below and running the animation loop for a layer that will never paint is
  // pure waste: bail before doing any of it rather than let the
  // IntersectionObserver further down notice and stop the loop only after the
  // event loop has already spun.
  //
  // This used to also catch most phones, via a `max-width: 90ch` rule that hid
  // the backdrops outright. That rule is gone -- phones get the art now, at
  // half scale -- so this is back to meaning only what it says.
  var wrap = pre.parentElement;
  if (wrap && getComputedStyle(wrap).display === "none") return;

  if (!pre.querySelectorAll(".header-art-row").length) return;

  // This file is the HOMEPAGE hero's animator and nothing else. The per-page
  // backdrops are run-length merged at build time (so there are no per-cell
  // nodes to address) and animated entirely by CSS -- see BACKDROP MOTION in
  // index.css. demo/template.html only ships this script on the homepage, so
  // this is belt-and-braces for anyone who wires it up by hand.
  if (pre.closest(".art-backdrop")) return;

  /**
   * THE RESOLUTION THIS SCREEN CAN ACTUALLY SHOW
   *
   * The hero ships twice (scripts/build-header-art.py --downsample): the
   * half-scale grid the page has inlined, and a full-resolution sibling named on
   * the wrapper as data-art-hires. Both are one span per character -- the melt
   * addresses cells as row*COLS+col, so they have to stay addressable at either
   * size; half scale just means 2,640 of them instead of 10,340.
   *
   * At 220 columns across a 390px screen a glyph is ~1.8px. Nothing the melt
   * does to a 1.8px cell is visible, so the fine grid is unbuyable on a phone at
   * any price, while the 7,700 extra nodes are very much payable. The breakpoint
   * is the stylesheet's (--art-detail; see IS THE DETAIL WORTH FETCHING? in
   * index.css), not a second copy of it here.
   *
   * Sequenced before start() rather than fired alongside it, which is the whole
   * reason this is not in src/index.js with the backdrops' version: the cell
   * arrays below are built once from whatever <pre> is in the document, so the
   * swap has to have happened first or not at all. The coarse art is already
   * painted and animating-capable meanwhile, so the wait costs nothing visible.
   */
  function withBestResolution(ready) {
    var hires = wrap && wrap.dataset ? wrap.dataset.artHires : "";
    var detail = wrap
      ? getComputedStyle(wrap).getPropertyValue("--art-detail").trim()
      : "0";
    var saveData = navigator.connection && navigator.connection.saveData;

    if (!hires || detail !== "1" || saveData) {
      ready();
      return;
    }

    fetch(hires)
      .then(function (response) {
        return response.ok ? response.text() : Promise.reject();
      })
      .then(function (markup) {
        // Parsed detached, so ~10k spans are built as one subtree and swapped in
        // whole rather than style-resolved as they arrive.
        var next = new DOMParser()
          .parseFromString(markup, "text/html")
          .querySelector(".header-art");
        if (!next) return;

        pre.replaceWith(next);
        pre = next;
        delete wrap.dataset.artHires;
      })
      .catch(function () {
        // The half-scale art is on screen and correct. A failed upgrade just
        // means the reader keeps it.
      })
      .then(function () {
        ready();
      });
  }

  withBestResolution(start);

  function start() {

    var rowEls = pre.querySelectorAll(".header-art-row");
    if (!rowEls.length) return;

    // ------------------------------------------------------------------ the grid

    var ROWS = rowEls.length;
    var cells = [];        // flat, row-major: row * COLS + col
    var base = [];         // the character each cell started as
    var tone = [];         // build-time tone tier, kept so we can restore it
    var rows = [];         // per-row arrays of cells, for the tear
    var COLS = 0;

    for (var r = 0; r < ROWS; r += 1) {
      var spans = rowEls[r].children;
      if (!COLS) COLS = spans.length;
      var rowCells = [];
      for (var c = 0; c < spans.length; c += 1) {
        var span = spans[c];
        cells.push(span);
        base.push(span.textContent);
        tone.push(span.className);
        rowCells.push(span);
      }
      rows.push(rowCells);
    }

    var COUNT = cells.length;
    if (!COUNT) return;

    // Tone tiers as numbers, so the render loop can lower a cell's tone without
    // parsing "k5" out of a class string 10,340 times a frame.
    var toneTier = [];
    for (var q = 0; q < COUNT; q += 1) {
      toneTier.push(parseInt(tone[q].slice(1), 10) || 0);
    }

    // Ordered by ink coverage, so stepping along it brightens or dims a cell
    // rather than just scrambling it.
    var RAMP = " -',_:;~^!+>|?r/\\Ll*)(vYcxz[]tiujf{I}1noCZhkXadbwOm#08Q&%MB$W@";

    // ------------------------------------------------------- state the effects share

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    // What each cell currently shows, so we only touch the DOM on a real change.
    var shownChar = base.slice();
    var shownClass = tone.slice();

    var pointer = { x: -1e6, y: -1e6, active: false };
    // pointer.active only ever flips off on pointerleave (the mouse leaving the
    // whole document), so a reader who parks the cursor anywhere on the page --
    // the common case -- would otherwise pin the loop at full frame rate for
    // the entire read. lastPointerMoveAt lets the melt settle back to the idle
    // cadence a moment after the cursor actually stops, which is when the
    // effect it drives is no longer visibly changing anyway.
    var lastPointerMoveAt = -Infinity;
    var POINTER_IDLE_MS = 200;
    var scrollVelocity = 0;
    var lastScrollY = window.scrollY;
    var tearRows = [];       // {row, shift, life}
    var booted = false;
    var bootStart = 0;
    var bootDone = false;
    var running = false;

    // The art drifts on its own, so the loop never settles to a stop. It is
    // gated instead: throttled to a slow tick when nothing is being touched, and
    // parked entirely when the art is off screen or the tab is in the background.
    var IDLE_GAP = 70;                        // ms between ambient repaints
    var lastPaint = 0;
    var onScreen = true;
    var awake = true;

    // --------------------------------------------------------------- noise field

    // Cheap value noise. Good enough to look organic, and far cheaper than
    // anything gradient-based when it runs over 10k cells.
    function noise(x, y, t) {
      var n = Math.sin(x * 0.13 + t * 0.0007) +
              Math.sin(y * 0.21 - t * 0.0005) +
              Math.sin((x + y) * 0.07 + t * 0.0011);
      return (n / 3 + 1) / 2; // 0..1
    }

    // ------------------------------------------------------------------- the loop

    // The pre's own box only moves on resize (fixed backdrops don't shift with
    // scroll; the homepage's in-flow copy doesn't shift as the terminal grows,
    // only the terminal's own rect does -- see overlayBoxes). Reading it fresh
    // every frame was a forced layout read on the hot path for no reason, so
    // it's cached here and only recomputed when the viewport actually changes.
    var cachedMetrics = null;

    function computeMetrics() {
      var box = pre.getBoundingClientRect();
      cachedMetrics = {
        left: box.left,
        top: box.top,
        w: box.width / COLS,
        h: box.height / ROWS
      };
    }

    function cellMetrics() {
      if (!cachedMetrics) computeMetrics();
      return cachedMetrics;
    }

    window.addEventListener("resize", function () {
      computeMetrics();
      // The shadow is cached in grid coordinates, which the new metrics change
      // the meaning of, so it has to be thrown away rather than merely re-keyed.
      dimKey = "";
      buildDimMap();
    });

    // char -> index, built once. rampShift used to call RAMP.indexOf(char),
    // an O(RAMP.length) scan repeated for every one of up to 65,120 cells every
    // frame -- a lookup table turns that into O(1).
    var RAMP_INDEX = {};
    for (var ramp_i = 0; ramp_i < RAMP.length; ramp_i += 1) RAMP_INDEX[RAMP[ramp_i]] = ramp_i;

    function rampShift(char, steps) {
      var i = RAMP_INDEX[char];
      if (i === undefined) return char;
      var next = Math.max(0, Math.min(RAMP.length - 1, i + steps));
      return RAMP[next];
    }

    /* ------------------------------------------------------- the terminal's shadow

       The terminal is laid into the art rather than placed on top of it, so the
       art recedes around it -- but never cleanly. The falloff is multiplied by the
       noise field, which makes the edge ragged and lets the art bleed into the
       text instead of stopping at a rectangle. Cells are dimmed by lowering their
       tone tier, reusing the k0..k7 palette rather than inventing another one, and
       never all the way to nothing: the art should still show through.
    */
    var DIM_FEATHER = 7;   // cells of falloff beyond the terminal's edge
    var DIM_MAX = 6;       // tone tiers to subtract at the centre

    // Everything laid into the art casts a shadow, not just the terminal.
    var OVERLAY_SELECTOR = ".tty-hero, .home-hero #site-guide";

    // Below 864px -- the width where the art stops having margins -- the site
    // guide casts no shadow at all, at any orientation (portrait already casts
    // none, see noShadowMQ below). Any fade of the art round the words, however
    // gentle, reads as a shaded patch behind them on a small screen; the guide
    // keeps its legibility there through a crisp edge on its own letters in
    // index.css instead, which leaves the art untouched right up to the words.
    // The terminal keeps its shadow. Above 864px nothing here changes.
    var softGuideMQ = window.matchMedia("(max-width: 864px)");

    function boxOf(el, m, feather, max) {
      var b = el.getBoundingClientRect();
      if (!b.width || !b.height) return null;
      return {
        x0: (b.left - m.left) / m.w,
        x1: (b.right - m.left) / m.w,
        y0: (b.top - m.top) / m.h,
        y1: (b.bottom - m.top) / m.h,
        feather: feather,
        max: max
      };
    }

    /** The overlaid elements' boxes in grid coordinates, each with its own strength. */
    function overlayBoxes(m, soft) {
      // These are built or re-laid out after this module runs, so re-query each
      // time rather than caching a stale list.
      var out = [];
      var terminal = document.querySelectorAll(soft ? ".tty-hero" : OVERLAY_SELECTOR);
      for (var i = 0; i < terminal.length; i += 1) {
        var tb = boxOf(terminal[i], m, DIM_FEATHER, DIM_MAX);
        if (tb) out.push(tb);
      }
      return out;
    }

    /**
     * The shadow, precomputed once per layout.
     *
     * This was the single most expensive thing on the page, and it was buying
     * nothing: dimStepsAt() ran per cell per frame, each call doing a sqrt per
     * overlay box plus a three-sin noise() -- around 20,000 sqrt and 31,000 sin
     * every frame at the homepage's full resolution -- to recompute a value that
     * cannot change between frames. The noise is seeded at t=0 on purpose (see
     * below), the grid does not move, and the boxes only move when the terminal
     * is re-laid out.
     *
     * So it is a lookup table now, rebuilt only when the geometry it depends on
     * actually changes. A Uint8Array because the result is 0..DIM_MAX.
     */
    var dimMap = new Uint8Array(COUNT);
    var dimKey = "";

    // The portrait/phone layout runs the art at one uniform tone: no shadow is
    // cast around the terminal or the site guide there. This is the same
    // condition index.css uses to drop the text halo for that layout, so the
    // two effects come and go together. Desktop and landscape keep both.
    var noShadowMQ = window.matchMedia("(max-aspect-ratio: 1/1)");

    function buildDimMap() {
      var m = cellMetrics();
      var off = noShadowMQ.matches;
      var soft = !off && softGuideMQ.matches;
      var boxes = off ? [] : overlayBoxes(m, soft);

      // Cheap identity for "the same shadow as last time". Rounded to whole
      // cells, which is the resolution the map is computed at anyway, so the
      // terminal growing by a fraction of a line does not force a rebuild.
      // Folding the mode in means rotating a device, or resizing a window across
      // the portrait boundary, rebuilds the map instead of keeping a stale one.
      var key = (off ? "off:" : soft ? "soft:" : "on:") + boxes
        .map(function (b) {
          return [b.x0 | 0, b.x1 | 0, b.y0 | 0, b.y1 | 0].join(",");
        })
        .join(";");
      if (key === dimKey) return;
      dimKey = key;

      // The map is an input to every cell's appearance, and the frame loop only
      // visits cells their own schedule marks as due -- so a new shadow has to
      // make everything due, or it would fade in cell by cell over the next few
      // seconds as unrelated twinkles happened to come round.
      invalidateSchedule();

      if (!boxes.length) {
        dimMap.fill(0);
        return;
      }

      for (var row = 0; row < ROWS; row += 1) {
        for (var col = 0; col < COLS; col += 1) {
          var steps = 0;
          for (var i = 0; i < boxes.length; i += 1) {
            var box = boxes[i];
            var dx = col < box.x0 ? box.x0 - col : (col > box.x1 ? col - box.x1 : 0);
            var dy = row < box.y0 ? box.y0 - row : (row > box.y1 ? row - box.y1 : 0);
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= box.feather) continue;

            // Modulate then clamp, rather than scaling the whole falloff by
            // noise: that way the core under the text is reliably dim enough to
            // read against, and it is the *edge* that goes ragged and lets the
            // art bleed back in.
            // Static seed, not a timestamp: an animated edge made the shadow
            // crawl, which read as another drifting blob. The raggedness should
            // be a fixed shape -- which is also what makes this cacheable.
            var f = 1 - dist / box.feather;
            f = Math.min(1, f * (0.8 + 0.6 * noise(col * 1.7, row * 1.7, 0)));
            var s = Math.round(f * box.max);
            if (s > steps) steps = s;
          }
          dimMap[row * COLS + col] = steps;
        }
      }
    }

    /**
     * Watch the overlays instead of measuring them every frame.
     *
     * The old loop called overlayBoxes() once per frame -- a querySelectorAll and
     * two getBoundingClientRect()s, i.e. a forced layout on the hot path, which
     * is exactly the mistake already fixed for the <pre>'s own box above. The
     * terminal does change shape as its output grows, so the measurement is
     * needed; it is just needed when the shape changes, not sixty times a second
     * in case it did.
     */
    function watchOverlays() {
      if (!("ResizeObserver" in window)) {
        // Without an observer, fall back to re-measuring on a slow timer. Still
        // vastly cheaper than per-frame, and the shadow lagging a command's
        // output by a moment is not something anyone can see.
        setInterval(buildDimMap, 400);
        return;
      }

      var observer = new ResizeObserver(buildDimMap);
      var els = document.querySelectorAll(OVERLAY_SELECTOR);
      for (var i = 0; i < els.length; i += 1) observer.observe(els[i]);

      // terminal.js replaces #tty-mount with .tty-hero after this module runs, so
      // the selector above can legitimately find nothing on the first pass.
      if (!els.length) {
        requestAnimationFrame(function () {
          var later = document.querySelectorAll(OVERLAY_SELECTOR);
          for (var j = 0; j < later.length; j += 1) observer.observe(later[j]);
          buildDimMap();
        });
      }
    }

    /* ------------------------------------------------------------------ the blink

       Red is not a wash roaming over the picture -- individual characters light up
       and fade out, each on its own slow cycle.

       Photosensitivity is the governing constraint here: every cell's phase is
       randomised so nothing ever flashes in unison, each cell cycles well under
       1Hz, only a small fraction of the grid is lit at any moment, and every blink
       ramps in and out rather than snapping. Nothing strobes.
    */
    var BLINK_MIN = 2600;   // ms: shortest per-cell cycle
    var BLINK_VAR = 5200;   // ms: additional randomised cycle length
    var BLINK_ON = 900;     // ms lit, fade included

    var blinkPeriod = new Float32Array(COUNT);
    var blinkPhase = new Float32Array(COUNT);

    for (var b = 0; b < COUNT; b += 1) {
      // Weighted by ink, so the red gathers on the figure rather than scattering
      // evenly across empty background.
      var weight = 0.2 + 0.8 * (toneTier[b] / 7);
      blinkPeriod[b] = Math.random() < 0.13 * weight
        ? BLINK_MIN + Math.random() * BLINK_VAR
        : 0;  // 0 means this cell never blinks
      blinkPhase[b] = Math.random() * (BLINK_MIN + BLINK_VAR);
    }

    function blinkLevel(i, now) {
      var period = blinkPeriod[i];
      if (!period) return 0;
      var t = (now + blinkPhase[i]) % period;
      if (t > BLINK_ON) return 0;
      var half = BLINK_ON / 2;
      return t < half ? t / half : 1 - (t - half) / half;  // triangular fade
    }

    /**
     * Ambient drift.
     *
     * Every cell keeps its own slow, independent cycle. That matters: driving this
     * from the noise field gave neighbouring cells correlated values, which read as
     * soft blobs drifting over the picture. Uncorrelated cells read as the surface
     * quietly twinkling instead.
     *
     * Each cell's direction is fixed and half the grid is assigned each way, so the
     * drift never brightens or darkens a region on average.
     */
    var TWINKLE_MIN = 2500;   // ms: shortest per-cell cycle
    var TWINKLE_VAR = 7500;   // ms: additional randomised cycle length
    var TWINKLE_ON = 400;     // ms spent shifted

    // Share of cells the pointer disturbs at its centre. Drop to 0 to make the
    // art completely inert under the mouse.
    var MELT_DENSITY = 0.5;

    var twPeriod = new Float32Array(COUNT);
    var twPhase = new Float32Array(COUNT);
    var twDir = new Int8Array(COUNT);
    // Fixed per cell, so a disturbed neighbourhood scrambles rather than glowing.
    var meltDir = new Int8Array(COUNT);
    // Fixed per cell as well: a stable scatter pattern, so cells do not flicker in
    // and out every frame as the pointer sits still.
    var meltThresh = new Float32Array(COUNT);

    for (var w = 0; w < COUNT; w += 1) {
      twPeriod[w] = TWINKLE_MIN + Math.random() * TWINKLE_VAR;
      twPhase[w] = Math.random() * twPeriod[w];
      twDir[w] = Math.random() < 0.5 ? -1 : 1;
      meltDir[w] = Math.random() < 0.5 ? -1 : 1;
      meltThresh[w] = Math.random();
    }

    function shimmerSteps(i, now) {
      var t = (now + twPhase[i]) % twPeriod[i];
      return t < TWINKLE_ON ? twDir[i] : 0;
    }

    /* --------------------------------------------------------------- the schedule

       The loop used to walk every cell every time it painted. That is the obvious
       way to write it and it is almost all waste: a cell's appearance is a pure
       function of its twinkle phase, its blink phase and the static dim map, and
       the two phases are long cycles with brief active windows. Twinkle is shifted
       for TWINKLE_ON/twPeriod of its cycle -- 400ms in 2500-10000, call it 6% --
       and blink only moves during BLINK_ON of a period, on the ~13% of cells that
       blink at all. Under a tenth of the grid can look different from one frame to
       the next, so nine cells in ten were being recomputed to arrive at the value
       they already had.

       So each cell carries the earliest time its own state could change, and a
       frame visits only the cells that are due. Everything the pointer, the tear
       or the boot touches is visited as well, since those are driven from outside
       the schedule. The effects are unchanged -- this is the same arithmetic on
       the same cells at the same moments, just not on the other ones.
    */
    var nextEvent = new Float64Array(COUNT);  // 0 = due now, so the first frame paints all

    /** Mark every cell due, for when something outside the schedule changed. */
    function invalidateSchedule() {
      nextEvent.fill(0);
      kick();
    }

    function scheduleOf(i, now) {
      // Twinkle: the next edge of its on/off window.
      var p = twPeriod[i];
      var t = (now + twPhase[i]) % p;
      var due = t < TWINKLE_ON ? now + (TWINKLE_ON - t) : now + (p - t);

      // Blink: a triangular fade, so while it is lit the cell genuinely changes
      // every frame and has to be visited every frame. Outside that window the
      // next thing that can happen is the window opening again.
      var bp = blinkPeriod[i];
      if (bp) {
        var bt = (now + blinkPhase[i]) % bp;
        var bdue = bt <= BLINK_ON ? now : now + (bp - bt);
        if (bdue < due) due = bdue;
      }
      return due;
    }

    /**
     * One cell, brought up to date.
     *
     * Lifted out of the nested loop it used to live in so that the frame can
     * choose which cells to call it for. `ctx` carries the per-frame values that
     * were closure variables before; passing one object keeps the call site from
     * growing a dozen arguments.
     */
    function paintCell(idx, row, col, ctx) {
      // A cell can be reached from more than one of the frame's lists -- due on
      // its own schedule, and also under the pointer, and also in a torn row --
      // so the stamp makes the work idempotent per frame rather than making
      // every caller check first.
      if (paintedIn[idx] === frameId) return;
      paintedIn[idx] = frameId;

      var char = base[idx];

      // boot: a diagonal wipe, with unrevealed cells masked to blank.
      if (ctx.bootProgress < 1 && col + row > ctx.revealEdge) {
        char = " ";
      } else if (ctx.bootProgress < 1 && col + row > ctx.revealEdge - 6) {
        // A noisy leading edge, so the wipe reads as typing rather than a bar.
        char = RAMP[(Math.random() * RAMP.length) | 0];
      }

      // A torn row is read from an offset, which slides its characters sideways.
      var shift = ctx.shiftOf[row] || 0;
      if (shift !== 0) {
        var src = col + shift;
        char = (src >= 0 && src < COLS) ? base[row * COLS + src] : " ";
      }

      // Ambient drift, always on -- this is what keeps the art alive when
      // nothing is being hovered.
      char = rampShift(char, shimmerSteps(idx, ctx.now));

      /* melt: the pointer stirs the glyphs without drawing anything.
       *
       * Two things gave the cursor away before. A minimum step size meant
       * cells flipped from "shifted by 2" to "not shifted" at the radius,
       * which drew a hard ring; and every cell inside the radius moved, which
       * made the disturbed area read as a disc. So the *proportion* of cells
       * affected now falls to zero at the edge, chosen by a fixed per-cell
       * threshold, and each moves a single step in its own direction. The
       * result scatters and fades out with no boundary and no brightness
       * change -- glyphs shift under the cursor, nothing traces it.
       */
      if (ctx.melting) {
        var dx = col - ctx.px;
        var dy = row - ctx.py;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < ctx.meltRadius) {
          var density = 1 - dist / ctx.meltRadius;
          if (meltThresh[idx] < density * MELT_DENSITY) {
            char = rampShift(char, meltDir[idx]);
          }
        }
      }

      var red = blinkLevel(idx, ctx.now);
      var rClass = red > 0.66 ? " r3" : red > 0.33 ? " r2" : red > 0.08 ? " r1" : "";
      // A lookup now, not a sqrt and three sins per cell per frame. See buildDimMap.
      var tier = toneTier[idx] - dimMap[idx];
      if (tier < 0) tier = 0;
      var nextClass = "k" + tier + rClass;

      if (shownChar[idx] !== char) {
        cells[idx].textContent = char;
        shownChar[idx] = char;
      }
      if (shownClass[idx] !== nextClass) {
        cells[idx].className = nextClass;
        shownClass[idx] = nextClass;
      }

      nextEvent[idx] = scheduleOf(idx, ctx.now);
    }

    // What the pointer and the tear disturbed last frame, so those cells get one
    // more visit to settle back. Without this a melted glyph would keep whatever
    // the melt last gave it once the finger moved on, since nothing in its own
    // schedule would ever mark it due again.
    var prevMelt = null;
    var prevTornRows = [];
    // Scratch, reused every frame rather than reallocated: row -> tear offset.
    var shiftOf = new Int32Array(ROWS);
    var ctx = {};
    // Which frame last touched each cell. From 1, because the array starts at 0
    // and the first frame must not mistake that for "already done".
    var frameId = 1;
    var paintedIn = new Uint32Array(COUNT);

    function frame(now) {
      if (!awake) { running = false; return; }

      var pointerActive = pointer.active && (now - lastPointerMoveAt < POINTER_IDLE_MS);
      var busy = pointerActive || tearRows.length || prevTornRows.length ||
                 prevMelt || !bootDone || Math.abs(scrollVelocity) > 0.4;
      // Interaction gets every frame; at rest the ambient drift only needs a slow
      // tick, which keeps the whole grid off the critical path.
      if (!busy && now - lastPaint < IDLE_GAP) {
        requestAnimationFrame(frame);
        return;
      }
      lastPaint = now;
      frameId += 1;

      var m = cellMetrics();

      // 11 cells was tuned for the homepage portrait's 220-column grid. Scaling by
      // COLS keeps the melt's felt size consistent on the half-scale phone grid
      // instead of it swallowing a disproportionate fraction of a smaller piece.
      var meltRadius = Math.max(4, Math.round(11 * (COLS / 220)));

      // Tear rows decay toward rest.
      for (var i = tearRows.length - 1; i >= 0; i -= 1) {
        tearRows[i].life -= 0.045;
        if (tearRows[i].life <= 0) tearRows.splice(i, 1);
      }

      // Once the boot is done it stays done: without this, a frame arriving after
      // the watchdog had already restored the art would re-apply the wipe and blank
      // it all over again.
      var bootProgress = (booted && !bootDone) ? Math.min(1, (now - bootStart) / 1400) : 1;
      if (bootProgress >= 1) bootDone = true;

      shiftOf.fill(0);
      var tornRows = [];
      for (var t = 0; t < tearRows.length; t += 1) {
        var tr = tearRows[t];
        if (!shiftOf[tr.row]) tornRows.push(tr.row);
        shiftOf[tr.row] += Math.round(tr.shift * tr.life);
      }

      ctx.now = now;
      ctx.bootProgress = bootProgress;
      ctx.revealEdge = bootProgress * (COLS + ROWS);
      ctx.shiftOf = shiftOf;
      ctx.melting = pointer.active;
      ctx.px = (pointer.x - m.left) / m.w;
      ctx.py = (pointer.y - m.top) / m.h;
      ctx.meltRadius = meltRadius;

      if (bootProgress < 1) {
        // The wipe rewrites the whole picture by definition, so there is nothing
        // to be clever about for its one and a half seconds.
        for (var row = 0; row < ROWS; row += 1) {
          for (var col = 0; col < COLS; col += 1) paintCell(row * COLS + col, row, col, ctx);
        }
      } else {
        // 1. Cells whose own twinkle or blink says they are due.
        for (var k = 0; k < COUNT; k += 1) {
          if (nextEvent[k] <= now) paintCell(k, (k / COLS) | 0, k % COLS, ctx);
        }

        // 2. The melt's neighbourhood, and wherever it just left.
        var melt = null;
        if (pointer.active) {
          melt = {
            r0: Math.max(0, Math.floor(ctx.py - meltRadius)),
            r1: Math.min(ROWS - 1, Math.ceil(ctx.py + meltRadius)),
            c0: Math.max(0, Math.floor(ctx.px - meltRadius)),
            c1: Math.min(COLS - 1, Math.ceil(ctx.px + meltRadius))
          };
        }
        paintRegion(melt, ctx);
        paintRegion(prevMelt, ctx);
        prevMelt = melt;

        // 3. Torn rows, and rows that have just finished tearing.
        paintRows(tornRows, ctx);
        paintRows(prevTornRows, ctx);
        prevTornRows = tornRows;
      }

      scrollVelocity *= 0.88;
      requestAnimationFrame(frame);
    }

    /** Repaint a rectangle of cells. */
    function paintRegion(box, ctx) {
      if (!box) return;
      for (var row = box.r0; row <= box.r1; row += 1) {
        for (var col = box.c0; col <= box.c1; col += 1) {
          paintCell(row * COLS + col, row, col, ctx);
        }
      }
    }

    /** Repaint whole rows. */
    function paintRows(list, ctx) {
      for (var i = 0; i < list.length; i += 1) {
        var row = list[i];
        var offset = row * COLS;
        for (var col = 0; col < COLS; col += 1) {
          paintCell(offset + col, row, col, ctx);
        }
      }
    }

    /**
     * Restore every cell to its built state, right now.
     *
     * The boot wipe blanks cells it has not reached yet, so if rAF stops firing
     * midway -- a backgrounded tab, an aggressively throttled renderer -- the art
     * would be stranded half-erased. This is the floor that cannot happen.
     */
    function paintBase() {
      // Static paths need the terminal's shadow too -- without it the art would sit
      // at full strength behind the text under reduced-motion. buildDimMap is a
      // no-op when the geometry has not moved since the last call, so this is safe
      // to call on every entry into paintBase.
      buildDimMap();
      for (var i = 0; i < COUNT; i += 1) {
        // Frozen at a single instant: a still scattering of red, no blinking.
        var red = blinkLevel(i, 0);
        var tier = toneTier[i] - dimMap[i];
        if (tier < 0) tier = 0;
        var cls = "k" + tier + (red > 0.66 ? " r3" : red > 0.33 ? " r2" : red > 0.08 ? " r1" : "");
        if (shownChar[i] !== base[i]) {
          cells[i].textContent = base[i];
          shownChar[i] = base[i];
        }
        if (shownClass[i] !== cls) {
          cells[i].className = cls;
          shownClass[i] = cls;
        }
      }
    }

    function kick() {
      if (running || !awake) return;
      running = true;
      requestAnimationFrame(frame);
    }

    function setAwake(next) {
      if (next === awake) return;
      awake = next;
      if (awake) kick();
    }

    // ------------------------------------------------------------------ listeners

    // Build the shadow once up front and then only when something moves. On the
    // reduced-motion path below, paintBase() calls this again itself once the
    // terminal exists.
    buildDimMap();
    watchOverlays();

    if (reduced.matches) {
      // Static, but still coloured: paint the noise field once and stop.
      paintBase();
      // terminal.js builds .tty-hero after this file runs, so the first paint has
      // no box to cast a shadow from. Paint once more when it exists, otherwise
      // reduced-motion readers get full-strength art behind the terminal text.
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          setTimeout(paintBase, 0);
        });
      } else {
        setTimeout(paintBase, 0);
      }
      return;
    }

    /* -------------------------------------------------------------- the pointer

       A mouse and a finger need different rules, and treating them the same was
       the worst thing on this page on a phone.

       A mouse hovers: it is over the document continuously, so `active` is
       latched on the first move and only cleared when the cursor leaves the
       window entirely. That is right for a mouse -- the melt should sit under a
       parked cursor -- and POINTER_IDLE_MS keeps a parked cursor from also
       holding the frame rate up.

       A finger does not hover. `pointerleave` never fires for touch, so that
       same latch meant the first scroll-flick on a phone turned the melt on
       permanently: thereafter every frame recomputed a melt around a stale
       coordinate, and every subsequent flick arrived to find the loop already
       pinned at full rate. The effect was invisible (the finger was long gone)
       and the cost was the entire grid, sixty times a second, on the one
       interaction a phone reader performs first.

       So for touch the melt lives between pointerdown and pointerup, which is
       also the gesture that was missing: press and drag and the glyphs stir
       under your finger. A flick that scrolls still passes through here, but it
       ends when the finger lifts, and the melt is centred where the finger
       actually is while it lasts.
    */
    function trackPointer(e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      // This assignment was missing. lastPointerMoveAt was declared, and frame()
      // tested it to decide whether the pointer counted as busy, but nothing ever
      // wrote to it -- so it stayed at -Infinity, `pointerActive` was always
      // false, and the melt has in fact been running at the 70ms idle cadence
      // (~14fps) rather than the per-frame rate its own comment describes.
      // Writing it makes the effect behave as documented; the scheduling work
      // above is what makes that affordable, since a busy frame now visits the
      // melt's own neighbourhood rather than all 10,340 cells.
      lastPointerMoveAt = performance.now();
      kick();
    }

    // On the window, not the art: .header-art is pointer-events: none so it can
    // neither be selected nor hovered, which would otherwise kill these events.
    window.addEventListener("pointermove", function (e) {
      // A touch contact reaches here as well as through pointerdown/up, and must
      // not re-latch the melt after the finger has lifted.
      if (e.pointerType === "touch" && !pointer.active) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        return;
      }
      pointer.active = true;
      trackPointer(e);
    });

    window.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;
      pointer.active = true;
      trackPointer(e);
    }, { passive: true });

    function endTouch(e) {
      if (e.pointerType !== "touch") return;
      pointer.active = false;
      kick();
    }

    window.addEventListener("pointerup", endTouch, { passive: true });
    window.addEventListener("pointercancel", endTouch, { passive: true });

    document.addEventListener("pointerleave", function () {
      pointer.active = false;
      kick();
    });

    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      var delta = y - lastScrollY;
      lastScrollY = y;
      scrollVelocity = delta;

      // Fast scrolling tears a few rows loose.
      if (Math.abs(delta) > 14) {
        var n = 1 + ((Math.random() * 3) | 0);
        for (var i = 0; i < n; i += 1) {
          tearRows.push({
            row: (Math.random() * ROWS) | 0,
            shift: (Math.random() * 18 - 9) | 0,
            life: 1
          });
        }
      }
      kick();
    }, { passive: true });

    // Start the type-in immediately. The art sits at the top of the homepage, so it
    // is on screen at load; deferring to an IntersectionObserver only allowed one
    // frame of fully-painted art before the wipe blanked it.
    document.addEventListener("visibilitychange", function () {
      setAwake(onScreen && !document.hidden);
    });

    // Scrolling past the art should stop the work, not merely hide it.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (records) {
        onScreen = records[0].isIntersecting;
        setAwake(onScreen && !document.hidden);
      }, { threshold: 0 }).observe(pre);
    }

    booted = true;
    bootStart = performance.now();
    kick();

    // Watchdog on a timer rather than a frame: setTimeout still fires where rAF is
    // throttled, so the art always ends up whole even if the animation never runs.
    setTimeout(function () {
      if (!bootDone) {
        bootDone = true;
        paintBase();
      }
    }, 2200);

  }
})();
