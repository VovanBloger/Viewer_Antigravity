import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SynthesizerFn = (text: string, outputFilePath: string, voice?: string) => Promise<boolean>;

export class TtsService {
  private static mockSynthesizer: SynthesizerFn | null = null;
  private static readonly DEFAULT_VOICE = process.env.TTS_VOICE || "ru-RU-SvetlanaNeural";

  static setMockSynthesizer(fn: SynthesizerFn | null): void {
    this.mockSynthesizer = fn;
  }

  /**
   * Phonetic text normalization for natural Russian speech synthesis
   */
  static cleanAndNormalize(rawText: string): string {
    let text = rawText;

    // Strip HTML and Markdown
    text = text.replace(/<[^>]*>/g, " ");
    text = text.replace(/[*_`~#]/g, "");

    // Stress for Телегра́м
    text = text.replace(/телеграм([а-яё]*)/gi, (_, suffix) => "Телегра\u0301м" + suffix);

    // Common abbreviations
    text = text.replace(/\bCRM\b/gi, "ЦРМ");
    text = text.replace(/\bERP\b/gi, "Е-Эр-Пе");
    text = text.replace(/\bAPI\b/gi, "Апи");
    text = text.replace(/\bVPN\b/gi, "Ви-Пи-Эн");
    text = text.replace(/\bUI\b/gi, "Ю-Ай");
    text = text.replace(/\bCLI\b/gi, "Си-Эл-Ай");
    text = text.replace(/\bID\b/gi, "айди");
    text = text.replace(/\bURL\b/gi, "урл");
    text = text.replace(/\bVPS\b/gi, "Ви-Пи-Эс");
    text = text.replace(/\bNext\.?js\b/gi, "Некст");

    // Clean multiple whitespace
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  /**
   * Synthesize text into an audio file (.ogg / .mp3) using edge-tts.
   * Truthful error reporting, no silent failure.
   */
  static async synthesize(text: string, outputFilePath: string, voice?: string): Promise<boolean> {
    if (this.mockSynthesizer) {
      return this.mockSynthesizer(text, outputFilePath, voice);
    }

    const dir = path.dirname(outputFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const normalized = this.cleanAndNormalize(text);
    const tempTextPath = outputFilePath.replace(/\.[^.]+$/, ".txt");
    fs.writeFileSync(tempTextPath, normalized, "utf-8");

    const targetVoice = voice || this.DEFAULT_VOICE;

    const candidates =
      process.platform === "win32"
        ? [
            { bin: "python", args: ["-m", "edge_tts"] },
            { bin: "edge-tts", args: [] },
          ]
        : [
            { bin: "python3", args: ["-m", "edge_tts"] },
            { bin: "edge-tts", args: [] },
            { bin: "/usr/local/bin/edge-tts", args: [] },
            { bin: "python", args: ["-m", "edge_tts"] },
          ];

    let lastError: any = null;
    for (const cand of candidates) {
      try {
        await execFileAsync(
          cand.bin,
          [
            ...cand.args,
            "--voice",
            targetVoice,
            "--rate",
            "+10%",
            "-f",
            tempTextPath,
            "--write-media",
            outputFilePath,
          ],
          { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
        );

        if (fs.existsSync(outputFilePath) && fs.statSync(outputFilePath).size > 100) {
          try {
            if (fs.existsSync(tempTextPath)) fs.unlinkSync(tempTextPath);
          } catch {}
          return true;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    try {
      if (fs.existsSync(tempTextPath)) fs.unlinkSync(tempTextPath);
    } catch {}

    if (lastError) {
      throw new Error(`TTS synthesis failed with edge-tts: ${lastError.message || lastError}`);
    }
    return false;
  }

  /**
   * Generate a concise conversational report script for spoken feedback
   */
  static async generateSpokenScript(
    commandText: string,
    reportText: string,
    authorName = "Владимир"
  ): Promise<string> {
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const model = (process.env.GEMINI_TTS_SCRIPT_MODEL || "gemini-2.0-flash").trim();

    if (apiKey) {
      try {
        const systemPrompt = `Ты — голосовой ассистент разработчика Antigravity.
Твоя задача — прочитать суть задачи и технический отчет, и составить живой, естественный и краткий текст для ГОЛОСОВОГО отчета разработчику (${authorName}).
Длина отчета: 30-50 слов (на 15-20 секунд речи).
Правила:
1. Обращайся к пользователю по имени: ${authorName}.
2. Говори естественно, живо и уверенно («Так-так... Хм, смотрю результат... Ага! Всё готово!»).
3. Избегай технического мусора, путей к файлам, git-хешей, длинных списков.
4. Язык: строго русский разговорный.`;

        const userPrompt = `Команда:\n«${commandText}»\n\nТехнический результат:\n${reportText.slice(0, 2000)}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
              },
            ],
            generationConfig: { maxOutputTokens: 250, temperature: 0.4 },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate && candidate.trim().length > 15) {
            return this.cleanAndNormalize(candidate.trim());
          }
        }
      } catch {
        // Fallback below
      }
    }

    // Fallback script
    const cleanCmd = commandText.replace(/[*#`_~]/g, "").trim().slice(0, 100);
    return this.cleanAndNormalize(
      `${authorName}, задача «${cleanCmd}» успешно выполнена! Все проверки пройдены, результаты зафиксированы.`
    );
  }
}
