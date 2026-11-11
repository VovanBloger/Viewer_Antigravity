/**
 * Разбор аргументов командной строки для CLI очереди. Чистые функции — без файлов и process.
 *
 * Формат: позиционные аргументы и опции вида --name=value либо --flag. После "--" всё позиционное.
 */

export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}

export interface ParsedArgs {
  positionals: string[];
  /** --name=value → строка; --flag → true. */
  options: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  let onlyPositionals = false;
  for (const arg of argv) {
    if (onlyPositionals || !arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!name) throw new ArgError(`Некорректная опция: ${arg}`);
    if (name in options) throw new ArgError(`Опция --${name} указана дважды`);
    options[name] = eq === -1 ? true : arg.slice(eq + 1);
  }
  return { positionals, options };
}

/** Опечатка в имени опции не должна молча игнорироваться. */
export function assertKnownOptions(args: ParsedArgs, allowed: readonly string[]): void {
  for (const name of Object.keys(args.options)) {
    if (!allowed.includes(name)) {
      const hint = allowed.length > 0 ? ` Допустимые: ${allowed.map((a) => `--${a}`).join(", ")}` : "";
      throw new ArgError(`Неизвестная опция --${name}.${hint}`);
    }
  }
}

export function optString(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  if (value === undefined) return undefined;
  if (value === true || value.trim() === "") throw new ArgError(`Опция --${name} требует значение: --${name}=<значение>`);
  return value;
}

export function requireString(args: ParsedArgs, name: string): string {
  const value = optString(args, name);
  if (value === undefined) throw new ArgError(`Не указана обязательная опция --${name}=<значение>`);
  return value;
}

export function optFlag(args: ParsedArgs, name: string): boolean {
  const value = args.options[name];
  if (value === undefined || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new ArgError(`Опция --${name} — флаг, значение не требуется`);
}

export interface NumberRule {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function optNumber(args: ParsedArgs, name: string, rule: NumberRule = {}): number | undefined {
  const raw = optString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    (rule.integer === true && !Number.isInteger(value)) ||
    (rule.min !== undefined && value < rule.min) ||
    (rule.max !== undefined && value > rule.max)
  ) {
    const kind = rule.integer === true ? "целым числом" : "числом";
    const from = rule.min !== undefined ? ` от ${rule.min}` : "";
    const to = rule.max !== undefined ? ` до ${rule.max}` : "";
    throw new ArgError(`Опция --${name} должна быть ${kind}${from}${to}, получено "${raw}"`);
  }
  return value;
}

/** Список через запятую: "a, b" → ["a", "b"]. */
export function optList(args: ParsedArgs, name: string): string[] | undefined {
  const raw = optString(args, name);
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Убирает BOM в начале текста, прочитанного из файла. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** "@path" → путь к файлу; иначе undefined. */
export function fileRef(value: string): string | undefined {
  return value.startsWith("@") && value.length > 1 ? value.slice(1) : undefined;
}

/** Кавычки для аргумента в готовой командной строке (годится и для PowerShell, и для bash). */
export function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_.:/\\=+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
