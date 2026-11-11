# Viewer 2 — Telegram Dev Bot Gateway & SQLite Queue Integration

Интеграция шлюза **Telegram Dev Bot** в единую транзакционную SQLite-очередь **Viewer 2** (`runtime/queue/store.ts`).

---

## 1. Архитектура и назначение

Предыдущая версия шлюза разработки (`C:/Users/vovan/Desktop/Antigravity Dev Bot`) использовала файловую модель `queue.json` с небезопасным конкурентным чтением/записью (`read-modify-write`), привязкой к жестким путям на Desktop и глобальным состоянием одного подтверждения (`pendingConfirmationId`).

Новая архитектура в `integrations/devbot`:
- **Единое SQLite-хранилище:** Все задачи (от Codex, Claude и Telegram) живут в атомарной очереди SQLite (`tasks`, `projects`, `events`, `notifications`), защищенной транзакциями `BEGIN IMMEDIATE … COMMIT`.
- **Durable Inbox в SQLite (`devbot_inbox`):** Входящие обновления сохраняются в SQLite до обработки. Курсор смещения (`devbot_cursor`) продвигается только после успешной фиксации обновлений на диске. Сбой процесса не приводит к потере или дублированию задач.
- **Атомарный Single-Poller Lock (`devbot_locks`):** Защита от запуска дублирующих процессов-поллеров привязана к идентификатору бота и SQLite базе данных (с таймаутом аренды и heartbeat). При конфликте процесс завершается (`fail-closed`), не убивая сторонние PID.
- **Множественные независимые подтверждения (Pending Confirmations):** Опасные команды получают уникальный ID (`CONF-...`), привязываются к конкретному `chat_id` и `user_id`, сохраняются в таблице `devbot_confirmations` и переживают перезапуск бота.
- **Точная маршрутизация проектов (Zero Substring Guessing):** Угадывание проектов по подстрокам («crm», «vpn») полностью удалено во избежание непреднамеренной перемаршрутизации. Проект выбирается явно кнопкой, командой `/project <id>` или префиксом `/p <id> <команда>`. Запрос несуществующего проекта отклоняется с ошибкой (без скрытого fallback).
- **Строгая авторизация:** Принимаются только положительные числовые Telegram User ID (`TELEGRAM_ALLOWED_USERS`). Имена пользователей (username) не используются как идентификатор. Команды разработки разрешены строго в приватных диалогах (`chat.type === "private"`), предотвращая утечки в группы.
- **Durable Outbox с защитой от дублирования:** Состояние отправки текста и голоса сохраняется в `devbot_outbox_progress`. Снимок отчёта фиксируется в момент создания события, поэтому старые раунды не перезаписываются новыми отчётами. Успешно отправленный текст **никогда не переотправляется** при ретраях голоса или перезапуске процесса.
- **Честные границы доставки:** В протоколе Telegram Bot API отсутствует сквозной client-generated idempotency key для `sendMessage`/`sendVoice`. Неустранимое окно неопределённости возникает при сетевом сбое между приёмом запроса сервером Telegram и получением HTTP-ответа клиентом. Это окно минимизировано за счёт пофрагментного сохранения прогресса в SQLite непосредственно до и после сетевых вызовов.
- **Изоляция локальных задач:** Локальные задачи координатора Codex/Claude (`notify.telegram = false`) не генерируют сетевых вызовов и уведомлений в Telegram.

---

## 2. Компоненты интеграции

```
integrations/devbot/
├── types.ts                      # Контракты Telegram, вложений, конфигурации и outbox
├── db.ts                         # SQLite хранилище: locks, inbox, cursor, confirmations, outbox
├── config.ts                     # Загрузка настроек, числовых ID и реестра проектов
├── client.ts                     # Telegram Bot API клиент: безопасный чанкинг (<=3900), redaction
├── security.ts                   # Числовая авторизация, валидация private chat, HTML escaping
├── keyboards.ts                  # Динамические инлайн-кнопки проектов, меню и подтверждений
├── handlers.ts                   # Обработка сообщений, голосовых, фото, документов (UUID + sanitize)
├── outbox.ts                     # Доставка отчетов и уведомлений в Telegram с retry и снимком
├── gateway.ts                    # Координатор polling, atomic DB lock, durable inbox
├── index.ts                      # Точка входа сервиса-демона
├── projects.config.example.json  # Пример конфигурации проектов с относительными путями
├── audio/
│   ├── stt.ts                    # Распознавание речи через явно заданную модель Gemini
│   └── tts.ts                    # Нормализация ударений и синтез речи через edge-tts
├── runner/
│   ├── cli.ts                    # Совместимый CLI (status, start, complete, fail)
│   ├── wait-command.ts           # Канонический адаптер слушателя для бесед Antigravity
│   └── migrate.ts                # Идемпотентный CLI импорта legacy queue.json в SQLite
└── tests/
    └── gateway.test.ts           # Набор тестов (конкуренция, replay, outbox, routing, security)
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
npm run devbot:wait -- --project=viewer --db=".viewer-live/agent-queue.db"
npm run devbot:wait -- --project=crm --db=".viewer-live/agent-queue.db"

# Завершение задачи и сохранение отчёта (отправку в Telegram выполняет демон)
npm run devbot:cmd complete T-000001 @report.txt --owner=antigravity-PC-0063db
npm run devbot:cmd fail T-000001 "Текст ошибки" --owner=antigravity-PC-0063db

# Идемпотентная миграция старой очереди в SQLite
npm run devbot:migrate -- \
  --queue="C:/path/to/queue.json" \
  --projects="C:/path/to/projects.config.json" \
  --db=".viewer-live/agent-queue.db"
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
   Найти конкретный процесс по заголовку или PID:
   ```powershell
   # Завершить ТОЛЬКО процесс старого бота Antigravity Dev Bot:
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*Antigravity Dev Bot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId }
   ```
2. **Импорт истории и существующих проектов в SQLite:**
   ```bash
   npm run devbot:migrate -- \
     --queue="C:/Users/vovan/Desktop/Antigravity Dev Bot/data/queue.json" \
     --projects="C:/Users/vovan/Desktop/Antigravity Dev Bot/config/projects.config.json" \
     --db="C:/Users/vovan/Documents/Codex/2026-11-11/new-chat/outputs/Viewer2/.viewer-live/agent-queue.db"
   ```
   *Примечание:* Исходные файлы `queue.json` и `projects.config.json` только читаются, в них ничего не записывается.
3. **Настройка переменных окружения:**
   В корне проекта задать в `.env`:
   ```env
   TELEGRAM_BOT_TOKEN="<ТОКЕН_БОТА>"
   TELEGRAM_ALLOWED_USERS="356165930"
   GEMINI_API_KEY="<КЛЮЧ_GEMINI>"
   VIEWER_QUEUE_DB="C:/Users/vovan/Documents/Codex/2026-11-11/new-chat/outputs/Viewer2/.viewer-live/agent-queue.db"
   ```
4. **Запуск нового шлюза Viewer 2:**
   ```bash
   npm run devbot:start
   ```

### План отката (Rollback)
Исходные файлы бота на `C:/Users/vovan/Desktop/Antigravity Dev Bot` не изменялись. В случае необходимости отката:
1. Завершить процесс нового шлюза через `Ctrl+C` или остановить процесс по PID.
2. Запустить старый бот:
   ```powershell
   cd "C:\Users\vovan\Desktop\Antigravity Dev Bot"; npm start
   ```

---

## 5. Границы и ограничения

- **Тестирование сетевого уровня:** Все тесты шлюза используют мок-транспорты (`mockFetch`, `mockTranscriber`, `mockSynthesizer`), проверяя логику дедупликации, отката, очереди и ретраев без реальных сетевых запросов к Telegram Bot API и внешним серверам.
- **Подключение секретов:** Токены ботов и API-ключи подключаются администратором локально через `.env` и никогда не выводятся в логи или отчёты.
- **Слияние веток:** Изменения зафиксированы в ветке `ag/telegram-gateway` в изолированном worktree. Слияние в `master` производится координатором root после инспекции.
