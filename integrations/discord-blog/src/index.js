/**
 * Posts to the blog from Discord.
 *
 * Discord calls this Worker (an "interactions endpoint") whenever you use the
 * `/post` command, or right-click a message -> Apps -> "Post to blog". The Worker
 * appends the text to today's file in the site's repo as one `@HH:MM` entry, and
 * that commit is what publishes it: the Pages workflow rebuilds the blog on every
 * push. See scripts/build-blog.py for the format being written.
 *
 * Nothing is trusted that Discord has not signed, and nothing is posted for
 * anyone but ALLOWED_USER_ID.
 */

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const EPHEMERAL = 64;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("blog-post", { status: 200 });

    const body = await request.text();
    if (!(await verified(request, body, env.DISCORD_PUBLIC_KEY))) {
      return new Response("bad signature", { status: 401 });
    }

    const interaction = JSON.parse(body);
    if (interaction.type === PING) return json({ type: PONG });
    if (interaction.type !== APPLICATION_COMMAND) return new Response("ignored", { status: 400 });

    const user = interaction.member?.user ?? interaction.user;
    if (!user || user.id !== env.ALLOWED_USER_ID) {
      return reply("this isn't yours to post to.");
    }

    const text = extractText(interaction);
    if (!text) return reply("nothing to post.");

    // GitHub can take longer than the 3 seconds Discord allows for a first
    // answer, so acknowledge now and edit in the result when the commit lands.
    ctx.waitUntil(
      publish(text, env, interaction).then(
        (url) => followUp(interaction, env, `posted. ${url}`),
        (err) => followUp(interaction, env, `didn't post: ${err.message}`)
      )
    );
    return json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  },
};

// ------------------------------------------------------------------ Discord

function extractText(interaction) {
  const data = interaction.data;
  if (data.type === 3) {
    // Message command: the text of the message that was right-clicked.
    const message = Object.values(data.resolved?.messages ?? {})[0];
    return (message?.content ?? "").trim();
  }
  return (data.options?.find((o) => o.name === "text")?.value ?? "").trim();
}

async function verified(request, body, publicKey) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKey) {
    console.log("verify: missing", { signature: !!signature, timestamp: !!timestamp, publicKey: !!publicKey });
    return false;
  }
  const message = new TextEncoder().encode(timestamp + body);
  // Workers has gone by both names for this algorithm; try the standard one,
  // then the older one, so a runtime on either side of the rename still works.
  for (const name of ["Ed25519", "NODE-ED25519"]) {
    try {
      const algorithm = name === "Ed25519" ? { name } : { name, namedCurve: "NODE-ED25519" };
      const key = await crypto.subtle.importKey("raw", hex(publicKey.trim()), algorithm, false, ["verify"]);
      const ok = await crypto.subtle.verify(name, key, hex(signature), message);
      if (!ok) console.log("verify: signature did not match (wrong DISCORD_PUBLIC_KEY?)", { algorithm: name });
      return ok;
    } catch (err) {
      console.log("verify: error", { algorithm: name, message: String(err), keyLength: publicKey.trim().length });
    }
  }
  return false;
}

function hex(s) {
  return Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
}

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
}

function reply(content) {
  return json({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });
}

function followUp(interaction, env, content) {
  return fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
}

// ------------------------------------------------------------------- GitHub

/** Day and time as they read on a wall clock in the blog's time zone. */
function stamp(zone, when = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(when)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** A line that looks like a stamp would split the entry in two; defuse it. */
function escapeStamps(text) {
  return text.replace(/^@(\d{1,2}:\d{2})[ \t]*$/gm, "\\@$1");
}

async function publish(text, env, interaction) {
  const { day, time } = stamp(env.BLOG_TIMEZONE);
  const path = `demo/blog/${day}.md`;
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "blog-post-worker",
  };
  const entry = `@${time}\n${escapeStamps(text)}\n`;

  // Read-modify-write, retried: two posts a second apart would otherwise lose
  // one to a stale sha.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await fetch(`${api}?ref=${env.GITHUB_BRANCH}`, { headers });
    let existing = "";
    let sha;
    if (current.status === 200) {
      const file = await current.json();
      existing = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
      sha = file.sha;
    } else if (current.status !== 404) {
      throw new Error(`GitHub said ${current.status} reading ${path}`);
    }

    const next = (existing ? existing.replace(/\n*$/, "\n\n") : "") + entry;
    const put = await fetch(api, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `blog: ${day} ${time}`,
        content: btoa(String.fromCharCode(...new TextEncoder().encode(next))),
        branch: env.GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.ok) return `https://atimetowait.com/blog/${day}/#${day}-${time.replace(":", "")}`;
    if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub said ${put.status} writing ${path}`);
  }
  throw new Error("GitHub kept rejecting the write; try again");
}
