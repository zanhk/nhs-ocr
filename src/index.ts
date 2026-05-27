import { handleTelegramMessage } from "./flows/telegram-message.ts";
import type { Env } from "./env.ts";
import {
  constantTimeEq,
  isAllowedChat,
  type TelegramUpdate,
} from "./lib/telegram.ts";

export { ExtractDocumentWorkflow } from "./workflows/extract-document.ts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("nhs-ocr ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === "/hooks/telegram") {
      const got = req.headers.get("x-telegram-bot-api-secret-token");
      if (!constantTimeEq(got, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }

      const update = (await req
        .json()
        .catch(() => ({}))) as TelegramUpdate;

      if (!update.message) {
        return new Response("ok");
      }

      if (!isAllowedChat(env, update.message.chat.id)) {
        console.log(
          `chat ${update.message.chat.id} not in allowlist; ignoring update ${update.update_id}`,
        );
        return new Response("ok");
      }

      ctx.waitUntil(
        handleTelegramMessage(env, update.message).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          console.error(`telegram message handler failed: ${m}`);
        }),
      );
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },
};
