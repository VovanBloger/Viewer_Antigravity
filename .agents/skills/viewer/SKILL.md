---
name: viewer
description: >-
  Быстрый запуск мобильной студии Viewer Antigravity 2.0 (по слэш-команде /viewer).
  Запускает локальный сервер на порту 3100, проверяет статус, предоставляет ссылки на воркспейс и мокапы,
  а также синхронизирует пакетную очередь правок через Local Bridge.
---

# /viewer — Студия препросмотра Viewer Antigravity 2.0

Когда пользователь вызывает команду `/viewer`:

## 1. Проверка и запуск сервера

1. Проверить, запущен ли уже сервер:
   Выполнить проверку `http://localhost:3100/api/antigravity-bridge`.
2. Если сервер не запущен:
   Запустить в фоновом режиме (`IsDaemon: true`):
   ```bash
   npx next start -p 3100
   ```
   (Либо `npm run dev` для режима с горячей перезагрузкой кода).
3. Убедиться в получении ответа `200 OK`.

## 2. Ссылки для пользователя

Предоставить ссылки:
- **Рабочая станция с мокапами:** [http://localhost:3100](http://localhost:3100)
- **Демо Telegram Mini App:** [http://localhost:3100/demo](http://localhost:3100/demo)
- **Local Bridge API:** [http://localhost:3100/api/antigravity-bridge](http://localhost:3100/api/antigravity-bridge)

## 3. Открытие внутри Antigravity IDE

Подсказать пользователю, что студию можно открыть в параллельной вкладке прямо в редакторе:
- Нажать `Ctrl+Shift+P` → `Simple Browser: Show` → `http://localhost:3100`.
