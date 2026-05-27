import type { Env } from "../env.ts";

const tg = (env: Env, method: string) =>
  `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

async function call(env: Env, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(tg(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `telegram ${method} failed ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    ok: boolean;
    result: unknown;
    description?: string;
  };
  if (!json.ok) {
    throw new Error(`telegram ${method} not ok: ${json.description}`);
  }
  return json.result;
}

export interface TelegramFileMeta {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export async function getFile(
  env: Env,
  fileId: string,
): Promise<TelegramFileMeta> {
  return (await call(env, "getFile", { file_id: fileId })) as TelegramFileMeta;
}

export async function downloadFile(
  env: Env,
  filePath: string,
): Promise<{ bytes: ArrayBuffer; etag: string | null }> {
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `telegram file download failed ${res.status}: ${await res.text()}`,
    );
  }
  return { bytes: await res.arrayBuffer(), etag: res.headers.get("etag") };
}

export async function sendMessage(
  env: Env,
  args: {
    chatId: string | number;
    text: string;
    replyToMessageId?: number;
  },
): Promise<{ message_id: number }> {
  return (await call(env, "sendMessage", {
    chat_id: args.chatId,
    text: args.text,
    parse_mode: "HTML",
    reply_parameters: args.replyToMessageId
      ? { message_id: args.replyToMessageId, allow_sending_without_reply: true }
      : undefined,
  })) as { message_id: number };
}

export async function sendDocument(
  env: Env,
  args: {
    chatId: string | number;
    fileBytes: ArrayBuffer | Uint8Array;
    fileName: string;
    mimeType: string;
    caption?: string;
    replyToMessageId?: number;
  },
): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append("chat_id", String(args.chatId));
  if (args.caption) {
    form.append("caption", args.caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
  }
  if (args.replyToMessageId) {
    form.append(
      "reply_parameters",
      JSON.stringify({
        message_id: args.replyToMessageId,
        allow_sending_without_reply: true,
      }),
    );
  }
  const blob = new Blob([args.fileBytes], { type: args.mimeType });
  form.append("document", blob, args.fileName);

  const res = await fetch(tg(env, "sendDocument"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      `telegram sendDocument failed ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    ok: boolean;
    result: { message_id: number };
    description?: string;
  };
  if (!json.ok) {
    throw new Error(`telegram sendDocument not ok: ${json.description}`);
  }
  return json.result;
}

export function constantTimeEq(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseAllowedChatIds(env: Env): Set<string> {
  return new Set(
    env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isAllowedChat(env: Env, chatId: number | string): boolean {
  return parseAllowedChatIds(env).has(String(chatId));
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export function pickLargestPhoto(
  photos: TelegramPhotoSize[],
): TelegramPhotoSize {
  return photos.reduce((max, p) =>
    (p.file_size ?? p.width * p.height) > (max.file_size ?? max.width * max.height)
      ? p
      : max,
  );
}
