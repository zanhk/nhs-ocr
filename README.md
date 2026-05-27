# nhs-ocr

Telegram bot on Cloudflare Workers that extracts structured data from UK Land Registry **TR1** (Transfer of Whole) documents using **Gemini 3.5 Flash**, and posts the result back to the group as a summary message + JSON file attachment.

## Architecture

```
Telegram group  →  POST /hooks/telegram  →  Worker (validate + ack)
                                                │
                                                ├─ R2 (DOCS)         original file bytes
                                                ├─ D1 (DB)           audit row (status=pending)
                                                └─ Workflow (EXTRACT_WORKFLOW)
                                                       load → extract → persist → notify
                                                       (Gemini 3.5 Flash call + idempotent notify)
```

Every input file and every Gemini response is persisted in D1 for audit and re-processing. The notify step is retry-idempotent via `summary_sent_at` / `file_sent_at` columns.

## Stack

- **Runtime:** Cloudflare Worker (TypeScript) + Cloudflare Workflows
- **Storage:** D1 (Drizzle ORM) + R2
- **AI:** Gemini 3.5 Flash via Google AI Studio (`gemini-3.5-flash`)
- **Telegram:** raw Bot API over fetch (no SDK)

## Setup

### 1. Cloudflare resources

Already provisioned on the `majestico` account:

- **D1:** `nhs-ocr` (`465af5d2-8edc-44c0-9a5b-1b85276e7069`)
- **R2:** `nhs-ocr-docs`
- **Worker name:** `nhs-ocr` (configured in `wrangler.jsonc`)

Migrations live in `drizzle/` and are applied via:

```bash
bun run db:apply:local
bun run db:apply:remote
```

To regenerate after a schema change in `src/db/schema.ts`:

```bash
bun run db:gen          # produces drizzle/NNNN_*.sql
bun run db:apply:remote
```

### 2. Create the Telegram bot

In Telegram, talk to [@BotFather](https://t.me/BotFather):

1. `/newbot` → choose name and username → receive the bot token.
2. **`/setprivacy` → `Disable`** for this bot.

   > Without this, the bot will only see commands, replies and `@mentions` in groups — it will NOT see uploaded documents/photos, so extraction won't trigger.

3. Add the bot to the target group and copy the group's chat ID (negative integer, e.g. `-1001234567890`).

### 3. Secrets and vars

`wrangler.jsonc` already contains the `vars.TELEGRAM_ALLOWED_CHAT_IDS` placeholder — replace it with a comma-separated list of allowed chat IDs:

```jsonc
"vars": {
  "TELEGRAM_ALLOWED_CHAT_IDS": "-1001234567890,-1009876543210"
}
```

Then set the secrets:

```bash
bunx wrangler secret put TELEGRAM_BOT_TOKEN
bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any random string — used to authenticate Telegram → Worker
bunx wrangler secret put GEMINI_API_KEY            # from https://aistudio.google.com/apikey
```

For local development, copy `.dev.vars.example` → `.dev.vars` and fill it in.

### 4. Deploy and register the webhook

```bash
bun run deploy

# After deploy, register the webhook against the deployed URL:
TG_TOKEN=<bot-token> TG_SECRET=<same-secret-as-above> \
  WORKER_ORIGIN=https://nhs-ocr.<your-subdomain>.workers.dev \
  bun run tg:set-webhook

TG_TOKEN=<bot-token> bun run tg:set-commands
```

## Usage

Drop a PDF, JPEG, PNG, WebP or HEIC of a TR1 form into the allowed group chat. Within ~1 second the bot replies "📄 Processing…". Within ~30–60 seconds it follows up with a summary message and a `tr1-extracted.json` file attachment.

The JSON structure is keyed by field name; each value is an object with `value`, `data_type`, `source_page`, `source_section`, `confidence_score`, `is_handwritten`, `ambiguity_reason` and a derived `requires_human_review` flag (see `src/lib/review-rules.ts` for the rules).

## Local dev

```bash
bun install
bun run dev               # boots wrangler dev on a local URL
```

To test the webhook locally you'll need a tunnel (e.g. `cloudflared tunnel`) since Telegram only POSTs to HTTPS endpoints reachable from the public internet.

## Audit / re-processing

The `documents` table records the full input + output of every extraction. Useful queries:

```bash
# Recent docs in a chat
bunx wrangler d1 execute nhs-ocr --remote --command \
  "SELECT id, status, created_at, file_name FROM documents WHERE chat_id='-1001234567890' ORDER BY created_at DESC LIMIT 20"

# Stuck jobs
bunx wrangler d1 execute nhs-ocr --remote --command \
  "SELECT id, status, started_at FROM documents WHERE status IN ('pending','processing') AND created_at < unixepoch() - 600"

# Pull the original PDF back from R2
bunx wrangler r2 object get nhs-ocr-docs documents/<id>.pdf --file=/tmp/out.pdf
```

To re-run extraction on an existing doc (e.g. after a prompt change), create a new workflow instance pointing at the same `documentId`.

## Limitations / known edge cases

- **Telegram bot file-download limit: 20 MB.** Larger files are rejected with a message in the chat.
- **Gemini inline-PDF cap:** ~1000 pages / 50 MB. TR1s are 1–4 pages so this is comfortable. Switch to the Gemini Files API if larger docs become common.
- **Confidence scores are model self-reports**, not calibrated probabilities. The `requires_human_review` flag uses them as one signal among several (handwritten signatures, missing required fields, model-flagged ambiguity).
- **Bot privacy mode** must be **Disabled** via @BotFather for groups (see §2 above).
- **Schema is fixed to UK TR1 for v1.** To support other doc types, generalise the responseSchema + prompt selection in `src/lib/tr1-schema.ts`.

## Project layout

```
src/
├── index.ts                       fetch handler, /hooks/telegram, exports the Workflow class
├── env.ts                         Env interface
├── flows/
│   └── telegram-message.ts        handles inbound documents/photos
├── workflows/
│   └── extract-document.ts        4-step Workflow (load, extract, persist, notify)
├── lib/
│   ├── telegram.ts                call(), sendMessage, sendDocument, getFile, downloadFile
│   ├── gemini.ts                  Gemini 3.5 Flash client with structured output
│   ├── tr1-schema.ts              TR1 responseSchema + prompt + PROMPT_VERSION
│   └── review-rules.ts            deriveRequiresReview + REVIEW_RULES_VERSION
└── db/
    ├── schema.ts                  Drizzle: documents table
    └── client.ts                  drizzle(env.DB)

drizzle/                           generated migration SQL (commit these)
scripts/                           set-telegram-webhook.mjs, set-telegram-commands.mjs
```
