import fs from "node:fs";
import { redactDeep } from "../../runtime/queue/redact.ts";
import type { SendMessageOptions, TelegramUpdate } from "./types.ts";

export type CustomFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TelegramClientOptions {
  token?: string;
  fetcher?: CustomFetch;
}

/**
 * Sanitizes URLs and sensitive tokens from error messages and logs.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED_TOKEN]")
    .replace(/https?:\/\/api\.telegram\.org\/bot[^\s"']+/g, "[REDACTED_TELEGRAM_URL]")
    .replace(/https?:\/\/[^\s"']+\.googleapis\.com[^\s"']*/g, "[REDACTED_GOOGLE_API_URL]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/key=[A-Za-z0-9_-]+/gi, "key=[REDACTED]");
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;
  private fileBaseUrl: string;
  private fetcher: CustomFetch;

  constructor(options?: string | TelegramClientOptions) {
    let token = "";
    let fetcher: CustomFetch = globalThis.fetch;

    if (typeof options === "string") {
      token = options;
    } else if (options) {
      token = options.token || "";
      if (options.fetcher) fetcher = options.fetcher;
    }

    if (!token) {
      token = (process.env.TELEGRAM_BOT_TOKEN || "").trim().replace(/^["']|["']$/g, "");
    }

    this.token = token.trim().replace(/^["']|["']$/g, "");
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${this.token}`;
    this.fetcher = fetcher;
  }

  setToken(token: string): void {
    this.token = token.trim().replace(/^["']|["']$/g, "");
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${this.token}`;
  }

  setFetcher(fetcher: CustomFetch): void {
    this.fetcher = fetcher;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.token.includes(":"));
  }

  async apiCall(method: string, payload: any = {}): Promise<any> {
    const url = `${this.baseUrl}/${method}`;
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35000),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      const sanitized = sanitizeErrorMessage(err.message || String(err));
      return { ok: false, error: sanitized };
    }
  }

  /**
   * Safely chunks text to <= 3900 characters (under Telegram's 4096 limit).
   * Respects line breaks and whitespace.
   */
  static splitIntoChunks(text: string, maxLen = 3900): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let current = "";

    const lines = text.split("\n");
    for (const line of lines) {
      if ((current ? current + "\n" + line : line).length <= maxLen) {
        current = current ? current + "\n" + line : line;
      } else {
        if (current) chunks.push(current);
        if (line.length <= maxLen) {
          current = line;
        } else {
          // Break very long unbroken line by space or slice
          let rest = line;
          while (rest.length > maxLen) {
            let splitIndex = rest.lastIndexOf(" ", maxLen);
            if (splitIndex <= 0) splitIndex = maxLen;
            chunks.push(rest.slice(0, splitIndex));
            rest = rest.slice(splitIndex).trimStart();
          }
          current = rest;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  async sendMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<any> {
    const chunks = TelegramClient.splitIntoChunks(text, 3900);

    let lastRes: any = null;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      lastRes = await this.sendSingleMessage(chatId, chunks[i], {
        ...options,
        reply_markup: isLast ? options?.reply_markup : undefined,
      });

      if (!lastRes || lastRes.ok === false) {
        return lastRes;
      }
    }
    return lastRes;
  }

  private async sendSingleMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<any> {
    const res = await this.apiCall("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode || "HTML",
      reply_markup: options?.reply_markup,
      disable_web_page_preview: options?.disable_web_page_preview ?? true,
    });

    if (!res.ok && res.description && res.description.includes("can't parse entities")) {
      // Fallback to plain text on entity parse errors
      return this.apiCall("sendMessage", {
        chat_id: chatId,
        text: text.replace(/<[^>]*>/g, ""),
        reply_markup: options?.reply_markup,
        disable_web_page_preview: options?.disable_web_page_preview ?? true,
      });
    }
    return res;
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: SendMessageOptions
  ): Promise<any> {
    return this.apiCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parse_mode || "HTML",
      reply_markup: options?.reply_markup,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<any> {
    return this.apiCall("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async sendChatAction(chatId: number | string, action: string): Promise<any> {
    return this.apiCall("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  async deleteWebhook(): Promise<any> {
    return this.apiCall("deleteWebhook", { drop_pending_updates: false });
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<any> {
    return this.apiCall("setMyCommands", { commands });
  }

  async getUpdates(offset = 0, limit = 50, timeout = 25): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl}/getUpdates?offset=${offset}&limit=${limit}&timeout=${timeout}`;
    try {
      const res = await this.fetcher(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
      const data = (await res.json()) as any;
      if (data.ok && Array.isArray(data.result)) {
        return data.result;
      }
      return [];
    } catch {
      return [];
    }
  }

  async getFile(fileId: string): Promise<{ ok: boolean; result?: { file_path: string; file_size?: number }; description?: string; error?: string }> {
    return this.apiCall("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    const url = `${this.fileBaseUrl}/${filePath}`;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      throw new Error(`Failed to download Telegram file: HTTP ${res.status}`);
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      throw new Error(`Размер файла превышает лимит (${Math.round(maxBytes / 1024 / 1024)} МБ)`);
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`Размер файла превышает лимит (${Math.round(maxBytes / 1024 / 1024)} МБ)`);
    }
    return Buffer.from(arrayBuffer);
  }

  async sendVoice(
    chatId: number | string,
    audioBufferOrPath: Buffer | string,
    caption?: string
  ): Promise<any> {
    let buffer: Buffer;
    if (typeof audioBufferOrPath === "string") {
      buffer = fs.readFileSync(audioBufferOrPath);
    } else {
      buffer = audioBufferOrPath;
    }

    // Inspect audio header to verify Ogg container
    const isOgg = buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "OggS";
    const mimeType = isOgg ? "audio/ogg" : "audio/mpeg";
    const fileName = isOgg ? "voice.ogg" : "voice.mp3";

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    if (caption) formData.append("caption", caption.slice(0, 1024));
    formData.append("voice", new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);

    const url = `${this.baseUrl}/sendVoice`;
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      return data;
    } catch (e: any) {
      const sanitized = sanitizeErrorMessage(e.message || String(e));
      return { ok: false, error: sanitized };
    }
  }
}
