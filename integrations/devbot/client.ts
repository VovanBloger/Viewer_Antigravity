import fs from "node:fs";
import type { SendMessageOptions, TelegramUpdate } from "./types.ts";

export type CustomFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TelegramClientOptions {
  token?: string;
  fetcher?: CustomFetch;
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
      return await res.json();
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async sendMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<any> {
    if (text.length > 4000) {
      const chunks: string[] = [];
      let current = "";
      const paragraphs = text.split("\n\n");
      for (const p of paragraphs) {
        if ((current ? current + "\n\n" + p : p).length <= 3900) {
          current = current ? current + "\n\n" + p : p;
        } else {
          if (current) chunks.push(current);
          if (p.length <= 3900) {
            current = p;
          } else {
            const lines = p.split("\n");
            for (const l of lines) {
              if ((current ? current + "\n" + l : l).length <= 3900) {
                current = current ? current + "\n" + l : l;
              } else {
                if (current) chunks.push(current);
                current = l;
              }
            }
          }
        }
      }
      if (current) chunks.push(current);

      let lastRes: any = null;
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        lastRes = await this.sendSingleMessage(chatId, chunks[i], {
          ...options,
          reply_markup: isLast ? options?.reply_markup : undefined,
        });
      }
      return lastRes;
    }

    return this.sendSingleMessage(chatId, text, options);
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

  async getFile(fileId: string): Promise<{ ok: boolean; result?: { file_path: string }; description?: string }> {
    return this.apiCall("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `${this.fileBaseUrl}/${filePath}`;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      throw new Error(`Failed to download Telegram file: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
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

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    if (caption) formData.append("caption", caption);
    formData.append("voice", new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }), "voice.ogg");

    const url = `${this.baseUrl}/sendVoice`;
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });
      return await res.json();
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  }
}
