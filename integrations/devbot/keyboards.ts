import type { InlineKeyboardButton } from "./types.ts";
import type { Project } from "../../runtime/queue/types.ts";

export class Keyboards {
  static getProjectsInline(projects: Project[], activeProjectId?: string): { inline_keyboard: InlineKeyboardButton[][] } {
    const rows: InlineKeyboardButton[][] = [];
    let currentRow: InlineKeyboardButton[] = [];

    const activeNorm = (activeProjectId || "").toLowerCase().trim();

    for (const proj of projects) {
      const isSelected = proj.id.toLowerCase() === activeNorm;
      const text = `${isSelected ? "🔘 " : "⚪ "}${proj.name} (${proj.id})`;
      currentRow.push({
        text,
        callback_data: `proj_select_${proj.id}`,
      });

      if (currentRow.length === 2) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    return { inline_keyboard: rows };
  }

  static getMainReply(): {
    keyboard: { text: string }[][];
    resize_keyboard: boolean;
    one_time_keyboard: boolean;
  } {
    return {
      keyboard: [
        [{ text: "📊 Статус системы" }, { text: "📂 Выбрать проект" }],
        [{ text: "❓ Справка" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    };
  }

  static getConfirmationInline(confirmationId: string): { inline_keyboard: InlineKeyboardButton[][] } {
    return {
      inline_keyboard: [
        [
          { text: "✅ Выполнить (ДА)", callback_data: `confirm_cmd_${confirmationId}` },
          { text: "❌ Отменить (НЕТ)", callback_data: `cancel_cmd_${confirmationId}` },
        ],
      ],
    };
  }
}
