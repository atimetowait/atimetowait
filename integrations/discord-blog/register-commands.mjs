// Registers the two commands with Discord. Run once, and again if you change them:
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node register-commands.mjs
const { DISCORD_APP_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("set DISCORD_APP_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const commands = [
  {
    name: "post",
    type: 1,
    description: "Publish a line to the blog",
    options: [{ name: "text", description: "what to say", type: 3, required: true, max_length: 2000 }],
  },
  { name: "Post to blog", type: 3 }, // right-click a message -> Apps
];

const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});
console.log(res.status, await res.text());
