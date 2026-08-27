/**
 * The footer terminal.
 *
 * Renders itself entirely from JS, so a reader without JavaScript gets a clean
 * page rather than a dead input box. It never captures global keystrokes --
 * typing only reaches it when the input is focused, so ordinary reading,
 * scrolling and find-in-page are untouched.
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
  input.setAttribute("aria-label", "Terminal input. Type help for commands.");

  function print(text, className) {
    var line = el("div", "tty-line" + (className ? " " + className : ""), text);
    out.appendChild(line);
    return line;
  }

  function printLink(text, href) {
    var line = el("div", "tty-line");
    var a = el("a", null, text);
    a.href = href;
    line.appendChild(a);
    out.appendChild(line);
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
      print("  " + pad(s.name, 14) + s.description, "tty-dim");
    });
    printBlank();
    print("musings/");
    manifest.entries.forEach(function (e) {
      print("  " + pad(e.date, 12) + pad(e.slug, 22) + e.summary, "tty-dim");
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

    print(entry.title, "tty-strong");
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
      print("  " + pad(e.date, 12) + pad(e.slug, 22) + e.summary, "tty-dim");
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
   * Two shapes. On the homepage the template leaves a #tty-mount div near the
   * top and the terminal becomes the page's front door, booting with `help`
   * already run. Everywhere else it's a quiet footer.
   */
  function build() {
    var mount = document.getElementById("tty-mount");
    var isHero = !!mount;

    var shell = el(isHero ? "section" : "footer", "tty" + (isHero ? " tty-hero" : ""));

    if (isHero) {
      shell.setAttribute("aria-label", "Terminal");
    } else {
      shell.appendChild(el("div", "tty-label", "— you can type here —"));
    }

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

    // Clicking anywhere in the terminal focuses the input, the way a real one
    // behaves -- but only within the terminal itself.
    shell.addEventListener("click", function (event) {
      if (event.target.tagName !== "A") input.focus();
    });

    if (isHero) {
      mount.replaceWith(shell);

      // Tuck the intro and the about text away -- they're reachable as `home`
      // and `whatami`. Done as a class here rather than in the stylesheet so
      // that with JS off the page still reads as ordinary prose.
      document.body.classList.add("home-terminal");
      // Also on <html>: the one-screen rule has to clip on the root element,
      // because clipping <body> would crop the full-bleed hero back to body's
      // 80ch measure.
      document.documentElement.classList.add("home-terminal");
    } else {
      document.body.appendChild(shell);
    }

    return isHero;
  }

  function boot(isHero) {
    if (!isHero) {
      print("type help.", "tty-dim");
      return;
    }

    // Deliberately short. The terminal now sits inside the artwork, so the boot
    // is a few lines rather than the full command listing -- `help` still prints
    // everything on request, so nothing is lost but the art stays visible.
    print("atimetowait — freya langley // aCadogan", "tty-strong");
    print("last login: whenever you got here. the dates don't mean much.", "tty-dim");
    printBlank();
    print("start with: home — or help for everything else", "tty-strong");
    printBlank();

    // Focus only where a keyboard is actually attached -- autofocusing on a
    // phone would throw up the software keyboard before anything is read.
    if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      input.focus({ preventScroll: true });
    }
  }

  function init() {
    var isHero = build();
    boot(isHero);

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
