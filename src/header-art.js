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

  // CSS already hides the whole wrap for `art off`, prefers-contrast/
  // reduced-transparency, and -- backdrops only -- any viewport <=90ch,
  // which is most phones (see [data-art="off"] and .art-backdrop's media
  // queries in index.css). Building the grid below and running the
  // animation loop for a layer that will never paint is pure waste, and on
  // a mirrored backdrop it is no longer a small waste: bail before doing
  // any of it rather than let the IntersectionObserver further down notice
  // and stop the loop only after the event loop has already spun.
  var wrap = pre.parentElement;
  if (wrap && getComputedStyle(wrap).display === "none") return;

  var rowEls = pre.querySelectorAll(".header-art-row");
  if (!rowEls.length) return;

  // The homepage locks to 100dvh and never scrolls, so the tear effect below is
  // near-dormant there. A backdrop sits behind a page of prose that scrolls
  // constantly, which would otherwise drive this into full-rate rAF for the
  // entire read. The tear is a scroll-specific effect anyway -- boot, twinkle,
  // blink and melt are unaffected and still run on a backdrop.
  var isBackdrop = !!pre.closest(".art-backdrop");

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
  // A backdrop shows the same fixed patch of art no matter where the page has
  // scrolled to -- there's no "coming up" region to precompute. What actually
  // helps is not fighting the scroll thread for the frame: this grid can run
  // over 6x the homepage portrait's cell count, so its idle repaint is paused
  // outright for the length of an active scroll gesture and picks back up a
  // beat after it settles, rather than racing it every single frame.
  var scrolling = false;
  var scrollEndTimer = null;
  var SCROLL_SETTLE_MS = 120;
  var tearRows = [];       // {row, shift, life}
  var booted = false;
  var bootStart = 0;
  var bootDone = false;
  var running = false;

  // The art now drifts on its own, so the loop never settles to a stop. It is
  // gated instead: throttled to a slow tick when nothing is being touched, and
  // parked entirely when the art is off screen or the tab is in the background.
  // Backdrops can run far larger than the homepage's 10,340-cell portrait --
  // this one is 65,120 -- so their idle tick is slower too: still smooth for a
  // background layer nobody is looking straight at, at a fraction of the cost.
  var IDLE_GAP = isBackdrop ? 130 : 70;     // ms between ambient repaints
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

  window.addEventListener("resize", computeMetrics);

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

  /** The overlaid elements' boxes in grid coordinates. */
  function overlayBoxes(m) {
    // Both halves of OVERLAY_SELECTOR only ever match inside .home-hero,
    // which only the homepage template renders -- a backdrop page can never
    // have one, so skip the query (and its getBoundingClientRect calls)
    // outright rather than running it every frame just to get [] back.
    if (isBackdrop) return [];

    // These are built or re-laid out after this module runs, so re-query each
    // time rather than caching a stale list.
    var els = document.querySelectorAll(OVERLAY_SELECTOR);
    var out = [];
    for (var i = 0; i < els.length; i += 1) {
      var b = els[i].getBoundingClientRect();
      if (!b.width || !b.height) continue;
      out.push({
        x0: (b.left - m.left) / m.w,
        x1: (b.right - m.left) / m.w,
        y0: (b.top - m.top) / m.h,
        y1: (b.bottom - m.top) / m.h
      });
    }
    return out;
  }

  function dimStepsAt(col, row, boxes, t) {
    if (!boxes || !boxes.length) return 0;

    var nearest = Infinity;
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i];
      var dx = col < box.x0 ? box.x0 - col : (col > box.x1 ? col - box.x1 : 0);
      var dy = row < box.y0 ? box.y0 - row : (row > box.y1 ? row - box.y1 : 0);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearest) nearest = dist;
    }
    if (nearest >= DIM_FEATHER) return 0;

    // Modulate then clamp, rather than scaling the whole falloff by noise: that
    // way the core under the text is reliably dim enough to read against, and it
    // is the *edge* that goes ragged and lets the art bleed back in.
    // Static seed, not `t`: an animated edge made the shadow crawl, which read
    // as another drifting blob. The raggedness should be a fixed shape.
    var f = 1 - nearest / DIM_FEATHER;
    f = Math.min(1, f * (0.8 + 0.6 * noise(col * 1.7, row * 1.7, 0)));
    return Math.round(f * DIM_MAX);
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

  function frame(now) {
    if (!awake) { running = false; return; }
    // Not during boot: the type-in wipe is timed against wall-clock elapsed
    // time, so pausing it here would just make it jump ahead once scrolling
    // settles rather than actually skip any work.
    if (scrolling && bootDone) { requestAnimationFrame(frame); return; }

    var pointerActive = pointer.active && (now - lastPointerMoveAt < POINTER_IDLE_MS);
    var busy = pointerActive || tearRows.length || !bootDone ||
               Math.abs(scrollVelocity) > 0.4;
    // Interaction gets every frame; at rest the ambient drift only needs a slow
    // tick, which keeps 10,340 cells off the critical path.
    if (!busy && now - lastPaint < IDLE_GAP) {
      requestAnimationFrame(frame);
      return;
    }
    lastPaint = now;

    var m = cellMetrics();
    // Read fresh each frame so the shadows follow the terminal as its output
    // grows or scrolls -- no observer needed, a couple of rect reads.
    var box = overlayBoxes(m);

    // Pointer position in grid coordinates.
    var px = (pointer.x - m.left) / m.w;
    var py = (pointer.y - m.top) / m.h;
    // 11 cells was tuned for the homepage portrait's 220-column grid. Scaling by
    // COLS keeps the melt's felt size consistent on a narrower backdrop drawing
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
    var revealEdge = bootProgress * (COLS + ROWS);

    for (var row = 0; row < ROWS; row += 1) {
      // A torn row is read from an offset, which slides its characters sideways.
      var shift = 0;
      for (var t = 0; t < tearRows.length; t += 1) {
        if (tearRows[t].row === row) shift += Math.round(tearRows[t].shift * tearRows[t].life);
      }

      for (var col = 0; col < COLS; col += 1) {
        var idx = row * COLS + col;
        var char = base[idx];

        // boot: a diagonal wipe, with unrevealed cells masked to blank.
        if (bootProgress < 1 && col + row > revealEdge) {
          char = " ";
        } else if (bootProgress < 1 && col + row > revealEdge - 6) {
          // A noisy leading edge, so the wipe reads as typing rather than a bar.
          char = RAMP[(Math.random() * RAMP.length) | 0];
        }

        if (shift !== 0) {
          var src = col + shift;
          char = (src >= 0 && src < COLS) ? base[row * COLS + src] : " ";
        }

        // Ambient drift, always on -- this is what keeps the art alive when
        // nothing is being hovered.
        char = rampShift(char, shimmerSteps(idx, now));

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
        if (pointer.active) {
          var dx = col - px;
          var dy = row - py;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < meltRadius) {
            var density = 1 - dist / meltRadius;
            if (meltThresh[idx] < density * MELT_DENSITY) {
              char = rampShift(char, meltDir[idx]);
            }
          }
        }

        var red = blinkLevel(idx, now);
        var rClass = red > 0.66 ? " r3" : red > 0.33 ? " r2" : red > 0.08 ? " r1" : "";
        var tier = Math.max(0, toneTier[idx] - dimStepsAt(col, row, box, now));
        var nextClass = "k" + tier + rClass;

        if (shownChar[idx] !== char) {
          cells[idx].textContent = char;
          shownChar[idx] = char;
        }
        if (shownClass[idx] !== nextClass) {
          cells[idx].className = nextClass;
          shownClass[idx] = nextClass;
        }
      }
    }

    scrollVelocity *= 0.88;
    requestAnimationFrame(frame);
  }

  /**
   * Restore every cell to its built state, right now.
   *
   * The boot wipe blanks cells it has not reached yet, so if rAF stops firing
   * midway -- a backgrounded tab, an aggressively throttled renderer -- the art
   * would be stranded half-erased. This is the floor that cannot happen.
   */
  function paintBase() {
    var t = performance.now();
    // Static paths need the terminal's shadow too -- without it the art would sit
    // at full strength behind the text under reduced-motion.
    var box = overlayBoxes(cellMetrics());
    for (var i = 0; i < COUNT; i += 1) {
      var row = (i / COLS) | 0;
      var col = i % COLS;
      // Frozen at a single instant: a still scattering of red, no blinking.
      var red = blinkLevel(i, 0);
      var tier = Math.max(0, toneTier[i] - dimStepsAt(col, row, box, t));
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

  // On the window, not the art: .header-art is pointer-events: none so it can
  // neither be selected nor hovered, which would otherwise kill these events.
  window.addEventListener("pointermove", function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    kick();
  });

  document.addEventListener("pointerleave", function () {
    pointer.active = false;
    kick();
  });

  if (!isBackdrop) {
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
  } else {
    // No tear, no velocity tracking -- just pause the idle repaint for the
    // length of the gesture and let the perpetual rAF loop's next tick pick
    // it back up once scrolling has actually settled.
    window.addEventListener("scroll", function () {
      scrolling = true;
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(function () { scrolling = false; }, SCROLL_SETTLE_MS);
    }, { passive: true });
  }

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

  // The type-in is a hero effect: the homepage art is the whole point of
  // that screen, on screen at load, worth its own 1.4s of full-grid,
  // every-frame work. A backdrop is deliberately peripheral -- "faint...
  // only lightly present" per demo/art/README.md -- and now runs at 2x the
  // cell count after mirroring, so it skips the wipe outright and starts
  // straight from the settled state; ambient twinkle/melt/blink still run
  // exactly as before.
  if (isBackdrop) {
    bootDone = true;
  } else {
    booted = true;
    bootStart = performance.now();
  }
  kick();

  // Watchdog on a timer rather than a frame: setTimeout still fires where rAF is
  // throttled, so the art always ends up whole even if the animation never runs.
  setTimeout(function () {
    if (!bootDone) {
      bootDone = true;
      paintBase();
    }
  }, 2200);
})();
