export type TranscriberFn = (audioBuffer: Buffer, mimeType: string) => Promise<string>;

export class SttService {
  private static mockTranscriber: TranscriberFn | null = null;

  static setMockTranscriber(fn: TranscriberFn | null): void {
    this.mockTranscriber = fn;
  }

  private static getApiKey(): string {
    return (process.env.GEMINI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  }

  static isConfigured(): boolean {
    return Boolean(this.mockTranscriber || this.getApiKey());
  }

  /**
   * Transcribe audio buffer (ogg, mp3, wav) into text via explicitly configured Google Gemini model.
   * No guessed model fallback loop; returns truthful errors on failure/quota.
   */
  static async transcribe(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
    if (this.mockTranscriber) {
      return this.mockTranscriber(audioBuffer, mimeType);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const model = (process.env.GEMINI_STT_MODEL || "gemini-2.0-flash").trim();
    const base64Data = audioBuffer.toString("base64");
    const promptText =
      "Внимательно прослушай это голосовое сообщение на русском языке. Предоставь точную, дословную текстовую расшифровку. Не добавляй собственных комментариев, примечаний и объяснений, только исключительно распознанные слова.";

    const body = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || "audio/ogg",
                data: base64Data,
              },
            },
            { text: promptText },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) message = parsed.error.message;
      } catch {}
      throw new Error(`Gemini STT (${model}) failed: ${message}`);
    }

    const data = (await res.json()) as any;
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }

    throw new Error("Gemini STT returned empty transcription candidate.");
  }
}
