import { deflateSync } from 'node:zlib';

export const MAX_RAW_WIDGET_BYTES = 32_768; // 32 KB
export const MAX_DEFLATED_WIDGET_BYTES = 4_096; // 4 KB

export interface WidgetValidationResult {
  ok: boolean;
  rawBytes: number;
  deflatedBytes: number;
  errors: string[];
}

export interface WidgetContext {
  chatData?: string;
  theme?: 'light' | 'dark';
  allowQueries?: boolean;
}

/** Validates Telegram Widget HTML payload against Bot API constraints. */
export function validateWidgetPayload(html: string): WidgetValidationResult {
  const errors: string[] = [];
  const buffer = Buffer.from(html, 'utf8');
  const rawBytes = buffer.byteLength;

  if (rawBytes === 0) {
    errors.push('WIDGET_EMPTY');
  }

  if (rawBytes > MAX_RAW_WIDGET_BYTES) {
    errors.push(`WIDGET_EXCEEDS_RAW_LIMIT: ${rawBytes} > ${MAX_RAW_WIDGET_BYTES}`);
  }

  let deflatedBytes = 0;
  try {
    const deflated = deflateSync(buffer, { level: 9 });
    deflatedBytes = deflated.byteLength;
    if (deflatedBytes > MAX_DEFLATED_WIDGET_BYTES) {
      errors.push(`WIDGET_EXCEEDS_DEFLATED_LIMIT: ${deflatedBytes} > ${MAX_DEFLATED_WIDGET_BYTES}`);
    }
  } catch {
    errors.push('WIDGET_COMPRESSION_FAILED');
  }

  // Check for suspicious remote script tags
  if (/<script[^>]+src=["'](https?:)?\/\//i.test(html)) {
    errors.push('REMOTE_SCRIPTS_FORBIDDEN_IN_WIDGET');
  }

  return {
    ok: errors.length === 0,
    rawBytes,
    deflatedBytes,
    errors
  };
}

/** Prepares a self-contained HTML document for the Widget sandbox renderer with simulated TelegramWidget bridge. */
export function buildWidgetSandboxHtml(widgetHtml: string, context: WidgetContext = {}): string {
  const validation = validateWidgetPayload(widgetHtml);
  if (!validation.ok) {
    throw new Error(`INVALID_WIDGET_PAYLOAD: ${validation.errors.join('; ')}`);
  }

  const initialChatData = JSON.stringify(context.chatData ?? '{}');
  const initialTheme = context.theme ?? 'dark';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: ${initialTheme}; }
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
  <script>
    (function() {
      const handlers = new Map();
      window.TelegramWidget = {
        chatData: ${initialChatData},
        theme: "${initialTheme}",
        onEvent: function(event, callback) {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event).push(callback);
        },
        offEvent: function(event, callback) {
          if (!handlers.has(event)) return;
          const list = handlers.get(event).filter(cb => cb !== callback);
          handlers.set(event, list);
        },
        request: function(data) {
          window.parent.postMessage({ type: 'telegram_widget_request', data: String(data) }, '*');
        },
        setTheme: function(theme) {
          this.theme = theme;
          document.documentElement.style.colorScheme = theme;
          const list = handlers.get('themeChanged') || [];
          for (const cb of list) cb(theme);
        },
        updateChatData: function(newData) {
          this.chatData = newData;
          const list = handlers.get('chatDataChanged') || [];
          for (const cb of list) cb(newData);
        }
      };
    })();
  </script>
</head>
<body>
  ${widgetHtml}
</body>
</html>`;
}
