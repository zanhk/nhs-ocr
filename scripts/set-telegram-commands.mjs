#!/usr/bin/env node
// Register the bot's slash-command menu. Idempotent.
// Usage: TG_TOKEN=... bun run tg:set-commands

const token = process.env.TG_TOKEN;
if (!token) {
  console.error("Missing env. Required: TG_TOKEN");
  process.exit(1);
}

const commands = [
  { command: "help", description: "How to use this bot" },
];

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands }),
});

const json = await res.json();
console.log(JSON.stringify(json, null, 2));
if (!json.ok) process.exit(1);
