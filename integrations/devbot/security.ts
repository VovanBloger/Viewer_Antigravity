export interface SecurityCheckResult {
  isDangerous: boolean;
  reason?: string;
  category?: "DATABASE" | "FILE_DELETION" | "CONFIG" | "DEPLOYMENT" | "GIT_FORCE";
}

export class SecurityGuard {
  static isAuthorized(chatId: number | string, username?: string | null, allowedUsers?: Set<string>): boolean {
    const allowed = allowedUsers || new Set(
      (process.env.TELEGRAM_ALLOWED_USERS || "356165930,Vovanbloger")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
    const idStr = String(chatId).trim().toLowerCase();
    if (allowed.has(idStr)) return true;
    if (username && allowed.has(username.toLowerCase().replace(/^@/, ""))) return true;
    return false;
  }

  static checkDangerous(text: string): SecurityCheckResult {
    const lower = text.toLowerCase();

    // 1. Database Destruction / Force Reset
    if (
      /\b(migrate\s+reset|prisma\s+db\s+push\s+--force-reset|drop\s+table|drop\s+database|truncate)\b/i.test(lower) ||
      /миграци(и|я|ю)\s+(сбросить|удалить|очистить)/i.test(lower) ||
      /сброс(ить)?\s+баз(у|ы|анных)/i.test(lower) ||
      /удалить\s+баз(у|ы)/i.test(lower)
    ) {
      return {
        isDangerous: true,
        category: "DATABASE",
        reason: "Опасная операция с базой данных (сброс миграций или удаление таблиц)",
      };
    }

    // 2. Mass file deletion
    if (
      /\b(rm\s+-rf|del\s+\/s|remove-item\s+-recurse|rmdir\s+\/s)\b/i.test(lower) ||
      /удали(ть|те)?\s+(файл|папку|директорию|все|базу)/i.test(lower) ||
      /стереть\s+(файл|папку|директорию)/i.test(lower)
    ) {
      return {
        isDangerous: true,
        category: "FILE_DELETION",
        reason: "Удаление файлов или директорий в проекте",
      };
    }

    // 3. Sensitive Config Overwrite (.env)
    if (
      /\.env/i.test(lower) &&
      (/перезапиш|перезаписать|замени|перепиши|rewrite|overwrite/i.test(lower) ||
        lower.includes("cat >") ||
        (lower.includes("echo ") && lower.includes(">")))
    ) {
      return {
        isDangerous: true,
        category: "CONFIG",
        reason: "Перезапись конфигурационных файлов или секретных переменных окружения (.env)",
      };
    }

    // 4. Production Deployment
    if (
      /\b(deploy:prod|deploy|деплой)\b/i.test(lower) ||
      /выкати\s+(на\s+)?(прод|боевой|сервер)/i.test(lower) ||
      /задеплой/i.test(lower)
    ) {
      return {
        isDangerous: true,
        category: "DEPLOYMENT",
        reason: "Деплой приложения на боевой сервер (Production)",
      };
    }

    // 5. Git Force Operations
    if (/git\s+push\s+.*--force/i.test(lower) || /git\s+reset\s+--hard/i.test(lower)) {
      return {
        isDangerous: true,
        category: "GIT_FORCE",
        reason: "Принудительная перезапись истории git (force push / hard reset)",
      };
    }

    return { isDangerous: false };
  }
}
