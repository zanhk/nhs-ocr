#!/usr/bin/env node
// Register the Telegram bot webhook to point at the deployed Worker.
// Usage: TG_TOKEN=... TG_SECRET=... WORKER_ORIGIN=https://... bun run tg:set-webhook

const token = process.env.TG_TOKEN;
const secret = process.env.TG_SECRET;
const origin = process.env.WORKER_ORIGIN;

if (!token || !secret || !origin) {
  console.error("Missing env. Required: TG_TOKEN, TG_SECRET, WORKER_ORIGIN");
  process.exit(1);
}

const url = `${origin.replace(/\/$/, "")}/hooks/telegram`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});

const json = await res.json();
console.log(JSON.stringify(json, null, 2));
if (!json.ok) process.exit(1);
