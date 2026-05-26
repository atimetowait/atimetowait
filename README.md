# The Monospace Web

Monospace fonts are dear to many of us. Some find them more readable, consistent, and beautiful, than their proportional alternatives. Maybe we’re just brainwashed from spending years in terminals? Or are we hopelessly nostalgic? I’m not sure. But I like them, and that’s why I started experimenting with all-monospace Web.

https://owickstrom.github.io/the-monospace-web/

## Install

```
npm install @owickstrom/the-monospace-web
```

## Usage

```html
<link rel="stylesheet" href="node_modules/@owickstrom/the-monospace-web/dist/reset.css">
<link rel="stylesheet" href="node_modules/@owickstrom/the-monospace-web/dist/index.css">
```

## Build

```
nix develop # or `direnv allow .`
make
```

## Local preview

Prerequisites match the build step: **GNU Make**, **Pandoc**, and **jq** (provided by `nix develop` / the dev shell in [flake.nix](flake.nix), which also includes **live-server** and **entr** for `make watch`).

1. `make` — generate `index.html` from `demo/index.md`.
2. `make serve` — serve the repository root with live reload (opens `/index.html`).
3. Optional: in a second terminal, `make watch` — rebuild `index.html` whenever `demo/index.md`, `demo/template.html`, or the `Makefile` changes.

| You edit | When the browser updates |
|----------|---------------------------|
| `src/*.css`, `src/index.js` | After save; live-server reloads. You do **not** need to run `make`. |
| `demo/index.md`, `demo/template.html` | After `make` (or `make watch` in another terminal) regenerates `index.html`. |

The `Makefile` uses Unix commands (`date`, `rm`). On Windows, use **WSL**, **Git Bash** with GNU Make and Pandoc installed, or **Docker** as below.

**Docker:** `cd` into the directory that contains `Dockerfile`, `Makefile`, and `package.json`, then run `docker compose up --build` and open [http://localhost:8080/](http://localhost:8080/). If `docker compose` reports that no compose file was found, you are in the wrong folder (for example your editor opened a parent directory that only contains another `monospace_site-main` folder). In that case either `cd` into that inner project folder, or from the parent run `docker compose -f docker-compose.nested.yml up --build` (see [docker-compose.nested.yml](../docker-compose.nested.yml) next to the inner project folder).

**Docker Compose Watch** (Docker Desktop “Live Watch”, or `docker compose watch` / `docker compose up --watch`): the compose file defines `develop.watch` on the `site` service. CSS/JS under `src/` are synced into the container; `demo/` and `Makefile` changes run `make` to regenerate `index.html`; `package.json` changes trigger an image rebuild. Requires Compose v2.22+ (`sync+exec` for Markdown rebuilds needs v2.32+).

The project directory is bind-mounted into the container, so edits to CSS or JS reload in the browser. On Windows or bind mounts from OneDrive, file watching uses polling (`CHOKIDAR_USEPOLLING`). Without Watch enabled, after changing Markdown or the HTML template, run `docker compose exec site make` (or restart the compose service) to regenerate `index.html`.

Ensure Docker Desktop can access this path under **Settings → Resources → File sharing** (or **General → Use the WSL 2 based engine** with the project under your WSL filesystem for fewer mount issues).

## License

[MIT](LICENSE.md)
