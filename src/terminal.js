/**
 * The homepage terminal.
 *
 * Renders itself entirely from JS, so a reader without JavaScript gets a clean
 * page rather than a dead input box. It never captures global keystrokes --
 * typing only reaches it when the input is focused, so ordinary reading,
 * scrolling and find-in-page are untouched. Every other page has no mount for
 * it (see init()) and gets no terminal at all.
 */
(function () {
  "use strict";

  var PROMPT = "atimetowait:~$";
  var MOODS = ["bone", "bruise", "vhs", "ember", "amber", "iodine"];
  var STORAGE_THEME = "atimetowait:theme";
  var STORAGE_ART = "atimetowait:art";

  var manifest = null;
  var history = [];
  var historyIndex = -1;
  var waitTimer = null;

  // ---------------------------------------------------------------- utilities

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pad(str, width) {
    str = String(str);
    return str + " ".repeat(Math.max(0, width - str.length));
  }

  // --------------------------------------------------------------- the shell

  var out = el("div", "tty-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");

  var input = el("input", "tty-input");
  input.type = "text";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  // A phone keyboard will otherwise offer to autocorrect `whatami` and `ls` into
  // English, and label its action key "return" rather than something that reads
  // like running the line.
  input.setAttribute("autocorrect", "off");
  input.setAttribute("enterkeyhint", "go");
  input.setAttribute("aria-label", "Terminal input. Type help for commands.");

  function print(text, className) {
    var line = el("div", "tty-line" + (className ? " " + className : ""), text);
    out.appendChild(line);
    return line;
  }

  /**
   * A line assembled from pieces, any of which may be a link.
   *
   * `ls` and `find` print slugs you are then expected to retype into `cd` or
   * `cat`. That is a fair trade with a keyboard and tab-completion under your
   * hands; on a phone, where neither exists, it is the whole reason the terminal
   * was unusable there -- the thing you want is on screen and there is no way to
   * act on it.
   *
   * Segments are strings, or {text, href} for the parts that should be
   * reachable. Padding deliberately stays in the plain-string segments so the
   * monospace columns still line up and the underline covers the slug rather
   * than a run of trailing spaces.
   */
  function printCells(segments, className) {
    var line = el("div", "tty-line" + (className ? " " + className : ""));
    for (var i = 0; i < segments.length; i += 1) {
      var seg = segments[i];
      if (typeof seg === "string") {
        line.appendChild(document.createTextNode(seg));
      } else {
        var a = el("a", "tty-link", seg.text);
        a.href = seg.href;
        line.appendChild(a);
      }
    }
    out.appendChild(line);
    return line;
  }

  function printLink(text, href) {
    return printCells([{ text: text, href: href }]);
  }

  /** Spaces to carry a column to `width`, never fewer than one. */
  function gap(text, width) {
    return " ".repeat(Math.max(1, width - String(text).length));
  }

  function printBlank() {
    out.appendChild(el("div", "tty-line", " "));
  }

  function scrollOut() {
    out.scrollTop = out.scrollHeight;
  }

  /**
   * The homepage prose lives in the HTML -- so it survives with JS off, and
   * still shows up in link previews and search results. The terminal reads it
   * from there rather than keeping a second copy in this file, which means
   * editing demo/index.md updates both at once.
   */
  var homeDocPromise = null;

  function homeDocument() {
    // Already on the homepage: the prose is right here in the document.
    if (document.getElementById("intro")) return Promise.resolve(document);

    if (!homeDocPromise) {
      homeDocPromise = fetch("/")
        .then(function (r) { return r.text(); })
        .then(function (t) { return new DOMParser().parseFromString(t, "text/html"); });
    }
    return homeDocPromise;
  }

  function printProse(selector) {
    var loading = print("…", "tty-dim");

    homeDocument()
      .then(function (doc) {
        loading.remove();

        var source = doc.querySelector(selector);
        if (!source) {
          print("that text has moved.", "tty-dim");
          scrollOut();
          return;
        }

        var block = el("div", "tty-prose");
        for (var i = 0; i < source.children.length; i += 1) {
          block.appendChild(document.importNode(source.children[i], true));
        }

        // The clone may have come from a fetched document, so re-apply the
        // external-link handling that index.js does for the live page.
        var anchors = block.querySelectorAll("a[href]");
        for (var j = 0; j < anchors.length; j += 1) {
          if (/^(https?:|mailto:)/i.test(anchors[j].getAttribute("href"))) {
            anchors[j].target = "_blank";
            anchors[j].rel = "noopener noreferrer";
          }
        }

        out.appendChild(block);
        scrollOut();
      })
      .catch(function () {
        loading.remove();
        print("couldn't reach that from here.", "tty-dim");
        scrollOut();
      });
  }

  // -------------------------------------------------------------- the theme

  function applyTheme(value) {
    var root = document.documentElement;
    if (value === "auto") {
      root.removeAttribute("data-theme");
      try { localStorage.removeItem(STORAGE_THEME); } catch (e) {}
    } else {
      root.setAttribute("data-theme", value);
      try { localStorage.setItem(STORAGE_THEME, value); } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- the art

  // One switch for both the homepage's full-bleed portrait and every other
  // page's faint backdrop (src/index.css: [data-art="off"]). Mirrored
  // pre-paint by the inline script in demo/template.html, the same way the
  // theme choice is, so a reader who has turned it off never sees it flash in.
  function applyArt(value) {
    var root = document.documentElement;
    if (value === "on") {
      root.removeAttribute("data-art");
      try { localStorage.removeItem(STORAGE_ART); } catch (e) {}
    } else {
      root.setAttribute("data-art", value);
      try { localStorage.setItem(STORAGE_ART, value); } catch (e) {}
    }
  }

  // ------------------------------------------------------------- the commands

  var commands = {};

  commands.help = function () {
    print("available:");
    var rows = [
      ["home", "who i am, briefly"],
      ["whatami", "what 'atimetowait' means"],
      ["ls", "what's here"],
      ["cd <section>", "go somewhere"],
      ["cat <entry>", "read an entry without leaving"],
      ["open <entry>", "open an entry properly"],
      ["find <term>", "search the writing"],
      ["mood <name>", "try on a palette — " + MOODS.join(", ")],
      ["theme <mode>", "light, dark, or auto"],
      ["art <mode>", "on or off, if the backdrop is too much"],
      ["date", "what time it is out there"],
      ["clear", "wipe this"],
    ];
    rows.forEach(function (r) {
      print("  " + pad(r[0], 14) + r[1]);
    });
    printBlank();
    print("(there are a few others. they aren't listed.)", "tty-dim");
  };

  commands.ls = function () {
    if (!manifest) return print("still loading.", "tty-dim");

    print("sections/");
    manifest.sections.forEach(function (s) {
      printCells(
        ["  ", { text: s.name, href: s.href }, gap(s.name, 14) + s.description],
        "tty-dim"
      );
    });
    printBlank();
    print("musings/");
    manifest.entries.forEach(function (e) {
      printCells(
        [
          "  " + pad(e.date, 12),
          { text: e.slug, href: e.href },
          gap(e.slug, 22) + e.summary
        ],
        "tty-dim"
      );
    });
  };

  commands.cd = function (args) {
    if (!manifest) return print("still loading.", "tty-dim");
    var name = (args[0] || "").replace(/^\/+|\/+$/g, "");
    if (!name) return print("cd where?", "tty-dim");

    var section = manifest.sections.find(function (s) { return s.name === name; });
    if (section) {
      print("→ " + section.href);
      window.location.href = section.href;
      return;
    }
    var entry = manifest.entries.find(function (e) { return e.slug === name; });
    if (entry) {
      print("→ " + entry.href);
      window.location.href = entry.href;
      return;
    }
    print("no such place: " + name, "tty-dim");
  };

  commands.open = commands.cd;

  commands.cat = function (args) {
    if (!manifest) return print("still loading.", "tty-dim");
    var slug = args[0];
    if (!slug) return print("cat what?", "tty-dim");

    var entry = manifest.entries.find(function (e) { return e.slug === slug; });
    if (!entry) return print("no entry called " + slug, "tty-dim");

    // The title is the obvious thing to reach for once you have decided you want
    // the whole entry, so it is the link as well as the footer's "read the rest".
    printCells([{ text: entry.title, href: entry.href }], "tty-strong");
    print(entry.date + "  ·  " + (entry.tags.join(", ") || "untagged") + "  ·  " + entry.mood, "tty-dim");
    printBlank();

    var loading = print("reading...", "tty-dim");

    fetch(entry.href)
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, "text/html");
        var body = doc.querySelector(".journal-entry");
        loading.remove();

        if (!body) {
          print("couldn't read it from here. try: open " + slug, "tty-dim");
          return;
        }

        var lines = body.innerText.split("\n").filter(function (l) {
          return l.trim().length;
        });
        var LIMIT = 14;
        lines.slice(0, LIMIT).forEach(function (l) {
          // The keysmash is load-bearing; don't let it blow out the footer.
          print(l.length > 200 ? l.slice(0, 200) + "…" : l);
        });
        if (lines.length > LIMIT) {
          printBlank();
          print("— " + (lines.length - LIMIT) + " more lines —", "tty-dim");
          printLink("read the rest ↗", entry.href);
        }
        scrollOut();
      })
      .catch(function () {
        loading.remove();
        print("couldn't read it from here. try: open " + slug, "tty-dim");
        scrollOut();
      });
  };

  commands.find = function (args) {
    if (!manifest) return print("still loading.", "tty-dim");
    var term = args.join(" ").toLowerCase();
    if (!term) return print("find what?", "tty-dim");

    var hits = manifest.entries.filter(function (e) {
      return (
        e.summary.toLowerCase().indexOf(term) !== -1 ||
        e.title.toLowerCase().indexOf(term) !== -1 ||
        e.slug.toLowerCase().indexOf(term) !== -1 ||
        e.tags.join(" ").toLowerCase().indexOf(term) !== -1
      );
    });

    if (!hits.length) return print("nothing for “" + term + "”.", "tty-dim");
    print(hits.length + (hits.length === 1 ? " match" : " matches") + ":");
    hits.forEach(function (e) {
      printCells(
        [
          "  " + pad(e.date, 12),
          { text: e.slug, href: e.href },
          gap(e.slug, 22) + e.summary
        ],
        "tty-dim"
      );
    });
  };

  commands.mood = function (args) {
    var name = args[0];
    if (!name) {
      print("moods: " + MOODS.join(", "));
      print("current: " + (document.documentElement.getAttribute("data-mood") || "bone"), "tty-dim");
      return;
    }
    if (MOODS.indexOf(name) === -1) {
      return print("no mood called " + name + ". try: " + MOODS.join(", "), "tty-dim");
    }
    document.documentElement.setAttribute("data-mood", name);
    print("wearing " + name + ".");
  };

  commands.theme = function (args) {
    var mode = args[0];
    if (["light", "dark", "auto"].indexOf(mode) === -1) {
      return print("theme light | dark | auto", "tty-dim");
    }
    applyTheme(mode);
    print("theme: " + mode);
  };

  commands.art = function (args) {
    var mode = args[0];
    if (["on", "off"].indexOf(mode) === -1) {
      return print("art on | off", "tty-dim");
    }
    applyArt(mode);
    print("art: " + mode);
  };

  /**
   * The site guide, said by the terminal.
   *
   * On touch the bottom-left guide is hidden (src/index.css) and this is the
   * way out of the homepage instead, so the links are read from that same
   * <nav> rather than listed here -- uncommenting a section in
   * demo/template.html restores it in both places at once. The lines arrive
   * one after another (.tty-pop), so the guide reads as coming out of the
   * terminal rather than having been there all along.
   */
  commands.lost = function () {
    var links = document.querySelectorAll("#site-guide .site-guide a[href]");
    if (!links.length) return print("there's nowhere else yet.", "tty-dim");

    print("are You lost?", "tty-strong tty-pop").style.setProperty("--pop", 0);
    for (var i = 0; i < links.length; i += 1) {
      printCells(
        ["  → ", { text: links[i].textContent, href: links[i].getAttribute("href") }],
        "tty-pop"
      ).style.setProperty("--pop", i + 1);
    }
  };

  commands.home = function () {
    printProse("#intro");
  };

  commands.whatami = function () {
    printProse("#whatami .home-prose");
  };

  // whoami is the unix reflex; it lands on the same words rather than keeping
  // a second, drifting copy of her bio in this file.
  commands.whoami = commands.home;

  commands.date = function () {
    var now = new Date();
    print(now.toString());
    print("though the entries here don't agree on what year it is.", "tty-dim");
  };

  commands.clear = function () {
    out.replaceChildren();
    if (waitTimer) {
      clearInterval(waitTimer);
      waitTimer = null;
    }
  };

  // ------------------------------------------------------- the unlisted ones

  commands.wait = function () {
    if (waitTimer) return print("already waiting.", "tty-dim");

    var started = Date.now();
    var line = print("waiting… 0.0s", "tty-strong");
    print("(clear stops it. it was always going to be you who stopped it.)", "tty-dim");

    waitTimer = setInterval(function () {
      var secs = (Date.now() - started) / 1000;
      line.textContent = "waiting… " + secs.toFixed(1) + "s";
    }, 100);
  };

  commands.sudo = function () {
    print("no.", "tty-strong");
    print("some things you don't get to skip.", "tty-dim");
  };

  commands.xoxo = function () {
    print("xoxo");
    print("-a.c.", "tty-dim");
  };

  commands.freya = function () {
    print("the name i release under now.");
    print("the others are still out there somewhere, unlisted.", "tty-dim");
  };

  commands.atimetowait = function () {
    print("a project named right after chemo started. around fifteen.");
    print("the sentiment being that all of this was just — a time to wait.", "tty-dim");
    printBlank();
    print("much of it is behind me now.");
  };

  commands.rm = function () {
    print("it's all still here. that's rather the point.", "tty-dim");
  };

  // ------------------------------------------------------------- the dispatch

  function run(raw) {
    var line = raw.trim();
    if (!line) return;

    print(PROMPT + " " + line, "tty-echo");

    var parts = line.split(/\s+/);
    var name = parts[0].toLowerCase();
    var args = parts.slice(1);

    if (commands[name]) {
      commands[name](args);
    } else {
      print(name + ": not a command. try help.", "tty-dim");
    }
    scrollOut();
  }

  function complete() {
    if (!manifest) return;
    var value = input.value;
    var parts = value.split(/\s+/);
    var last = parts[parts.length - 1].toLowerCase();
    if (!last) return;

    var pool =
      parts.length === 1
        ? Object.keys(commands)
        : manifest.entries
            .map(function (e) { return e.slug; })
            .concat(manifest.sections.map(function (s) { return s.name; }))
            .concat(MOODS);

    var hits = pool.filter(function (c) { return c.indexOf(last) === 0; });

    if (hits.length === 1) {
      parts[parts.length - 1] = hits[0];
      input.value = parts.join(" ") + " ";
    } else if (hits.length > 1) {
      print(PROMPT + " " + value, "tty-echo");
      print("  " + hits.join("   "), "tty-dim");
      scrollOut();
    }
  }

  // ------------------------------------------------------------------- wiring

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      var value = input.value;
      if (value.trim()) {
        history.push(value);
        historyIndex = history.length;
      }
      input.value = "";
      run(value);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (historyIndex > 0) {
        historyIndex -= 1;
        input.value = history[historyIndex];
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex += 1;
        input.value = history[historyIndex];
      } else {
        historyIndex = history.length;
        input.value = "";
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      complete();
    }
  });

  /**
   * The homepage template leaves a #tty-mount div near the top, and the
   * terminal becomes that page's front door. Every other page has no mount,
   * and init() returns before this runs -- the footer version that used to
   * render there was pure chrome around a box the backdrop art couldn't show
   * through, so it's gone rather than kept as an unused second shape.
   */
  function build(mount) {
    var shell = el("section", "tty tty-hero");
    shell.setAttribute("aria-label", "Terminal");
    shell.appendChild(out);

    var promptRow = el("div", "tty-prompt-row");
    promptRow.appendChild(el("span", "tty-prompt", PROMPT));
    promptRow.appendChild(input);
    // Autofocus only reaches devices with a real keyboard (see boot()), so on
    // everything else the input can otherwise look inert. This idle cursor
    // blinks until the reader's first focus, signalling the terminal is ready
    // to type into. It's a flex sibling of the (wide, flex-grown) input, so it
    // sits at the far right of the row rather than beside typed text -- fine
    // while the input is empty, but wrong once there's a value. Retiring it
    // permanently on first focus (rather than toggling with :focus-within)
    // keeps it from reappearing, misplaced, after the reader blurs the input.
    var caret = el("span", "tty-caret");
    caret.setAttribute("aria-hidden", "true");
    promptRow.appendChild(caret);
    input.addEventListener(
      "focus",
      function () {
        promptRow.classList.add("tty-engaged");
      },
      { once: true }
    );
    shell.appendChild(promptRow);

    /**
     * Something to tap.
     *
     * The terminal's two ways in -- Tab to complete and ArrowUp for history --
     * are both keys, and autofocus is deliberately withheld on touch (see
     * boot()), so a phone reader arrived at a prompt with no completion, no
     * history and no hint that any particular word would work. These are the
     * commands the boot message already points at, as buttons -- plus `lost`,
     * which stands in for the site guide on touch. It takes `ls`'s place
     * rather than adding a fifth chip, since five wrap to a second row on a
     * phone; `ls` still works typed.
     *
     * They go through run() rather than carrying their own behaviour, so there
     * is one definition of what `home` does and the echoed line looks exactly as
     * it would had you typed it. Hidden on fine pointers by CSS rather than
     * never built, so that a laptop with a touchscreen gets them when it is
     * being touched.
     */
    var chips = el("div", "tty-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Common commands");

    [["lost?", "lost"], ["home", "home"], ["help", "help"], ["whatami", "whatami"]].forEach(function (c) {
      var chip = el("button", "tty-chip", c[0]);
      chip.type = "button";
      chip.addEventListener("click", function () {
        run(c[1]);
      });
      chips.appendChild(chip);
    });
    shell.appendChild(chips);

    // Clicking anywhere in the terminal focuses the input, the way a real one
    // behaves -- but only within the terminal itself. Buttons are excluded
    // alongside links: tapping a chip should run it, not also throw up the
    // software keyboard over the output it just printed.
    shell.addEventListener("click", function (event) {
      var tag = event.target.tagName;
      if (tag !== "A" && tag !== "BUTTON") input.focus();
    });

    mount.replaceWith(shell);

    // Tuck the intro and the about text away -- they're reachable as `home`
    // and `whatami`. Done as a class here rather than in the stylesheet so
    // that with JS off the page still reads as ordinary prose.
    document.body.classList.add("home-terminal");
    // Also on <html>: the one-screen rule has to clip on the root element,
    // because clipping <body> would crop the full-bleed hero back to body's
    // 80ch measure.
    document.documentElement.classList.add("home-terminal");
  }

  function boot() {
    // Deliberately short. The terminal sits inside the artwork, so the boot
    // is a few lines rather than the full command listing -- `help` still prints
    // everything on request, so nothing is lost but the art stays visible.
    print("atimetowait — freya langley // aCadogan", "tty-strong");
    print("last login: whenever you got here. the dates don't mean much.", "tty-dim");
    print("start with: home — or help for everything else", "tty-strong");
    // Neither blank line from here is left any more. The one between this
    // and the prompt row doubled up with .tty-hero .tty-prompt-row's own
    // padding-top, which already did that job; this one (between "last
    // login" and "start with") was pure pacing, not separating anything
    // that needed separating. Both cost a full line each of the hero's
    // height on mobile, where that height is the terminal's footprint over
    // the art -- every line here is a line more of the figure it covers.
    // The words themselves are unchanged.

    // Focus only where a keyboard is actually attached -- autofocusing on a
    // phone would throw up the software keyboard before anything is read.
    if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      input.focus({ preventScroll: true });
    }
  }

  function init() {
    // Every page other than the homepage has no mount: it gets no terminal at
    // all now, rather than a footer copy, so there's no boxed-off chrome for
    // the backdrop art to compete with and nothing here to build or fetch for.
    var mount = document.getElementById("tty-mount");
    if (!mount) return;

    build(mount);
    boot();

    fetch("/site-manifest.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { manifest = data; })
      .catch(function () {
        print("(couldn't load the site index — ls and cat won't work)", "tty-dim");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
