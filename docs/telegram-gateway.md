# Viewer 2 — Telegram Dev Bot Gateway & SQLite Queue Integration

Интеграция шлюза **Telegram Dev Bot** в единую транзакционную SQLite-очередь **Viewer 2** (`runtime/queue/store.ts`).

---

## 1. Архитектура и назначение

Предыдущая версия шлюза разработки (`C:/Users/vovan/Desktop/Antigravity Dev Bot`) использовала файловую модель очереди `queue.json` с небезопасным конкурентным чтением/записью (`read-modify-write`), привязкой к жестким путям на Desktop и глобальным состоянием одного подтверждения (`pendingConfirmationId`).

Новая архитектура в `integrations/devbot`:
- **Единое SQLite-хранилище:** Все задачи (от Codex, Claude и Telegram) живут в атомарной очереди SQLite (`tasks`, `projects`, `events`, `notifications`), защищенной `BEGIN IMMEDIATE … COMMIT`.
- **Конфигурируемость и переносимость:** Пути вычисляются динамически относительно настраиваемой директории (`DEVBOT_DATA_DIR` или `.viewer-live/devbot`), без захардкоженных путей к Desktop.
- **Множественные независимые подтверждения (Pending Confirmations):** Опасные команды получают уникальный ID (`CONF-...`) и регистрируются независимо. Нажатие подтверждения/отмены на одном сообщении не ломает другие ожидающие задачи.
- **Надежный Long-Polling:** Персистентное сохранение смещения (`persisted offset`) и строгая дедупликация `update_id` защищают от повторной обработки команд при рестартах процесса и сбоях сети.
- **Outbox-уведомления с разделением текста и голоса:** Уведомления о статусах формируются в таблице `notifications`. Успешная отправка текста фиксируется отдельно — временный сбой синтезатора речи (TTS) **не приводит** к повторной отправке текстового отчета пользователю при ретрае.
- **Изоляция локальных задач:** Локальные задачи координатора Codex/Claude (`notify.telegram = false`) не генерируют сетевых вызовов в Telegram.

---

## 2. Компоненты интеграции

```
integrations/devbot/
├── types.ts                      # Контракты Telegram, вложений, конфигурации и outbox
├── config.ts                     # Загрузка настроек, переменных окружения и реестра проектов
├── client.ts                     # Легковесный клиент Telegram Bot API с поддержкой custom fetch
├── security.ts                   # Авторизация по белому списку и детекция опасных команд
├── keyboards.ts                  # Динамические инлайн-кнопки проектов, меню и подтверждений
├── handlers.ts                   # Обработка сообщений, голосовых, фото, документов и callback-запросов
├── outbox.ts                     # Доставка отчетов и уведомлений в Telegram с retry
├── gateway.ts                    # Координатор polling, single-instance lock и dedup
├── index.ts                      # Точка входа сервиса-демона
├── projects.config.example.json  # Пример конфигурации проектов (включая viewer, crm, vpn, game)
├── audio/
│   ├── stt.ts                    # Распознавание речи через Gemini API с поддержкой моков
│   └── tts.ts                    # Нормализация ударений и синтез речи через edge-tts с моками
├── runner/
│   ├── cli.ts                    # Фасад CLI (status, start, complete, fail)
│   └── wait-command.ts           # Слушатель очереди для фонового ожидания в беседах Antigravity
└── tests/
    └── gateway.test.ts           # Набор тестов (replay, media, unknown project, cancel, outbox retries)
```

---

## 3. Команды управления

### Запуск и проверка
```bash
# Запуск шлюза Telegram Dev Bot (демон)
npm run devbot:start

# Проверка статуса очереди и зарегистрированных проектов
npm run devbot:cmd status

# Запуск тихого слушателя очереди (0 токенов в ожидании)
npm run devbot:wait -- --project=viewer
npm run devbot:wait -- --project=crm

# Завершение задачи и отправка отчёта
npm run devbot:cmd complete T-000001 @report.txt
npm run devbot:cmd fail T-000001 "Текст ошибки"
```

### Тестирование и верификация типов
```bash
# Запуск полного набора юнит-тестов (core + runtime + devbot)
npm test

# Строгая проверка типов TypeScript
npx tsc --noEmit
```

---

## 4. План безопасного переключения (Live Cutover) и отката (Rollback)

### Шаги переключения (Live Cutover)
1. **Остановка старого бота на Desktop:**
   ```powershell
   # Завершить процесс Antigravity Dev Bot на Desktop
   Get-Process -Name node | Stop-Process
   ```
2. **Импорт истории и существующих проектов в SQLite:**
   ```bash
   node --import tsx runtime/queue/legacy-import.ts \
     --queue="C:/Users/vovan/Desktop/Antigravity Dev Bot/data/queue.json" \
     --projects="C:/Users/vovan/Desktop/Antigravity Dev Bot/config/projects.config.json"
   ```
3. **Настройка переменных окружения:**
   В корне проекта задать в `.env`:
   ```env
   TELEGRAM_BOT_TOKEN="<ТОКЕН_БОТА>"
   TELEGRAM_ALLOWED_USERS="356165930,Vovanbloger"
   GEMINI_API_KEY="<КЛЮЧ_GEMINI>"
   VIEWER_QUEUE_DB="C:/Users/vovan/Documents/Codex/2026-11-11/new-chat/outputs/Viewer2/.viewer-live/agent-queue.db"
   ```
4. **Запуск нового шлюза Viewer 2:**
   ```bash
   npm run devbot:start
   ```

### План отката (Rollback)
Исходные файлы бота на `C:/Users/vovan/Desktop/Antigravity Dev Bot` не изменялись. В случае необходимости отката:
1. Остановить процесс нового шлюза: `Ctrl+C` или завершить процесс `node`.
2. Запустить старый бот:
   ```powershell
   cd "C:\Users\vovan\Desktop\Antigravity Dev Bot"; npm start
   ```

---

## 5. Границы и ограничения

- **Тестирование сетевого уровня:** Все тесты шлюза используют мок-транспорты (`mockFetch`, `mockTranscriber`, `mockSynthesizer`), проверяя логику дедупликации, отката, очереди и ретраев без реальных сетевых запросов к Telegram Bot API и внешним серверам.
- **Подключение секретов:** Токены ботов и API-ключи подключаются администратором локально через `.env` и никогда не выводятся в логи или отчёты.
- **Слияние веток:** Изменения зафиксированы в ветке `ag/telegram-gateway` в изолированном worktree. Слияние в `master` производится координатором root после инспекции.
