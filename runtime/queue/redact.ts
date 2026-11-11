/**
 * Вычищение секретов из текста, который попадает в очередь (спецификации, отчёты, события).
 * Правила намеренно консервативны: обычный текст, SHA коммитов, пути и id заданий не трогаются.
 */

const R = "[REDACTED]";

/** Символы, которые не могут входить в «слово» строки запроса. */
const QUERY_RUN = /[^\s"'`<>]*auth_date=[^\s"'`<>]*/g;

type Rule = (text: string) => string;

const RULES: Rule[] = [
  // Заголовки Cookie / Set-Cookie — значение до конца строки.
  (t) => t.replace(/\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, `$1${R}`),
  // Telegram WebApp initData: строка запроса с auth_date и hash / signature — целиком.
  (t) => t.replace(QUERY_RUN, (run) => (/(?:^|[?&#])(?:hash|signature)=/.test(run) ? R : run)),
  // Отдельный hash=<hex> (кусок initData).
  (t) => t.replace(/\bhash=[0-9a-fA-F]{32,}\b/g, `hash=${R}`),
  // Токены ботов Telegram.
  (t) => t.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, R),
  // Authorization: Bearer <token>.
  (t) => t.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, `$1 ${R}`),
  // Ключи OpenAI / Anthropic.
  (t) => t.replace(/\bsk-[A-Za-z0-9_-]{20,}/g, R),
  // Ключи Google API.
  (t) => t.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, R),
  // Токены GitHub.
  (t) => t.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, R),
  // Присваивания в стиле окружения: BOT_TOKEN = ..., API_KEY="...", DB_PASSWORD=...
  (t) =>
    t.replace(
      /\b([A-Z0-9_]*(?:TOKEN(?!S)|API_?KEY|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)([ \t]*=[ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"'=,;&][^\s"',;&]*)/g,
      `$1$2${R}`,
    ),
  // То же в нижнем регистре, но только слитно (параметры URL и .env): token=..., api_key=...
  (t) =>
    t.replace(
      /\b([A-Za-z0-9_]*(?:token(?!s)|api_?key|secret|password|passwd)[A-Za-z0-9_]*)=("[^"\r\n]*"|'[^'\r\n]*'|[^\s"'=,;&()[\]{}][^\s"',;&]*)/gi,
      `$1=${R}`,
    ),
];

/** Заменяет найденные секреты на "[REDACTED]". */
export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of RULES) out = rule(out);
  return out;
}

/** Рекурсивно применяет redactSecrets ко всем строкам в объектах и массивах; возвращает новую структуру. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(item);
    }
    return out as T;
  }
  return value;
}
