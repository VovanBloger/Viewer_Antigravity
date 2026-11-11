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
   * Transcribe audio buffer (ogg, mp3, wav) into text via Google Gemini API
   */
  static async transcribe(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
    if (this.mockTranscriber) {
      return this.mockTranscriber(audioBuffer, mimeType);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

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

    const models = [
      "gemini-3.8-flash",
      "gemini-flash-latest",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-transcribe",
    ];

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as any;
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate && candidate.trim()) {
          return candidate.trim();
        }
      } catch {
        // Try next model candidate
      }
    }

    throw new Error("Не удалось распознать речь через Gemini API.");
  }
}
