# Posting to the blog from Discord

`/post text:<anything>` in Discord, or right-click a message → **Apps → Post to blog**,
appends one `@HH:MM` entry to today's `demo/blog/YYYY-MM-DD.md` and commits it. The
Pages workflow rebuilds the blog on every push, so it is live in about a minute. The
bot answers (only to you) with the entry's link.

Discord can only push to something that is listening, which a Cloudflare Worker is
for free: it runs only when you use the command, so there is no server to keep alive.
The trade-off is that it is a command, not "any message I type in a channel" -- that
would need an always-on bot process.

## One-time setup

### 1. Discord application

1. <https://discord.com/developers/applications> → **New Application** → name it `blog`.
2. **General Information**: copy **Application ID** and **Public Key**.
3. **Bot** → **Reset Token**, copy it. (Only used once, to register the commands.)
4. **Installation** → under *Install Link* choose **Discord Provided Link**; in
   *Default Install Settings* add scope `applications.commands` (guild install).
   Open the link and add it to a server you own -- a private one with just you is ideal.
5. Your user ID: Discord → Settings → Advanced → **Developer Mode** on, then right-click
   yourself → **Copy User ID**.

### 2. GitHub token

GitHub → Settings → Developer settings → **Fine-grained tokens** → generate:
repository access **Only select repositories → atimetowait/atimetowait**,
permission **Contents: Read and write**. Nothing else. Copy it.

### 3. Cloudflare Worker

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. In this folder (needs Node 20+): `npm install`, then `npx wrangler login`.
3. Edit `wrangler.toml` and set `BLOG_TIMEZONE` to your time zone (IANA name).
4. `npx wrangler deploy`. It prints the Worker's URL, like
   `https://blog-post.<you>.workers.dev`.
5. Set the three secrets (each prompts for the value):

   ```
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put ALLOWED_USER_ID
   npx wrangler secret put GITHUB_TOKEN
   ```

### 4. Connect them

1. Back in the Discord developer portal → **General Information** →
   **Interactions Endpoint URL** → paste the Worker URL → **Save**. Discord sends a
   test request; it only saves if the Worker answered correctly, which also proves
   the public key is right.
2. Register the commands:
   `DISCORD_APP_ID=<id> DISCORD_BOT_TOKEN=<token> node register-commands.mjs`
   It should print `200`.

Try `/post text:hello` in your server.

## When something is off

- *Endpoint URL won't save*: `DISCORD_PUBLIC_KEY` is wrong or unset -- re-run its
  `secret put`.
- *"this isn't yours to post to"*: `ALLOWED_USER_ID` isn't your user ID.
- *"GitHub said 404/403"*: the token lacks Contents write on the repo, or expired.
- *Posted but not live*: check the repo's Actions tab for the Pages run.
- Entries land on the wrong day or hour: `BLOG_TIMEZONE`; re-run `npx wrangler deploy`.
- Logs while you test: `npx wrangler tail`.
