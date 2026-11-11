/**
 * Viewer 2 — типы для интеграции Telegram Dev Bot.
 */

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
    keyboard?: any[][];
    resize_keyboard?: boolean;
    one_time_keyboard?: boolean;
    remove_keyboard?: boolean;
  };
  disable_web_page_preview?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
    };
    date: number;
    text?: string;
    caption?: string;
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    audio?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    photo?: {
      file_id: string;
      file_size?: number;
      width: number;
      height: number;
    }[];
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: { id: number };
    };
    data?: string;
  };
}

export interface DevBotAttachment {
  type: "photo" | "document" | "voice";
  filePath: string;
  fileName?: string;
}

export interface PendingConfirmation {
  id: string;
  chatId: number;
  userId: number;
  idempotencyKey?: string;
  author: string;
  text: string;
  projectId: string;
  dangerReason: string;
  dangerCategory?: "DATABASE" | "FILE_DELETION" | "CONFIG" | "DEPLOYMENT" | "GIT_FORCE" | string;
  attachments: DevBotAttachment[];
  createdAt: number | string;
  status?: "PENDING" | "APPROVED" | "CANCELLED" | "EXPIRED";
}

export interface OutboxDeliveryResult {
  notificationId: number;
  taskId: string;
  textSent: boolean;
  voiceSent: boolean;
  error?: string;
}

export interface DevBotProjectConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  path: string;
  branch?: string;
  aliases?: string[];
  testCommand?: string;
  typecheckCommand?: string;
  deployCommand?: string;
  url?: string;
}
