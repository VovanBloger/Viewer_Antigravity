# Viewer 2 Platform — Статус реализации и отчет готовности

Дата формирования: **11.11.2026** (обновлено перед передачей в Claude в 11:40 MSK)  
Ветка: **`viewer2-platform`**  
Репозиторий: `https://github.com/VovanBloger/Viewer_Antigravity.git`  
Базовый каталог: `C:/Users/vovan/Documents/Codex/2026-11-11/new-chat/outputs/Viewer2`  
Общая живая база SQLite: `.viewer-live/agent-queue.db`

---

## 1. Сводка состояния выполнения генерального плана (10 пунктов)

| № | Пункт плана | Статус | Реализация и тесты |
|---|---|---|---|
| 1 | **Единый репозиторий** (runtime, gateway, browser, UI) | **Выполнено** | Все модули собраны в монорепозитории `Viewer2`. Без внешних несогласованных зависимостей. |
| 2 | **Координация моделей через MCP** (Codex / Claude / Antigravity Gemini 3.8 Flash) | **Выполнено** | `runtime/mcp/server.ts` (queue MCP) + `runtime/browser/mcp.ts` (browser MCP). Native CLI `runtime/cli/task.ts`, `wait-task.ts`. |
| 3 | **Надежная SQLite очередь** (leases, heartbeats, idempotency, secret redaction) | **Выполнено** | `runtime/queue/store.ts`, `types.ts`, `redact.ts`. Поддержка WAL-режима, 6 параллельных процессов, защита от утечек секретов. |
| 4 | **Настоящий Telegram WebK через Playwright** (10 testDC + 2 prod актора, сессии, профили) | **Выполнено** | `runtime/browser/lab.ts`, `defaults.ts`, `testing.ts`. Изолированные persistent profiles, chat policy, навигация, кнопки inline/reply, запуск Mini App, скриншоты реальных пикселей. Ограничение кэша Chromium (32 МБ) и автоочистка артефактов (`pruneArtifacts`). |
| 5 | **Widgets / HTML bubbles** (TelegramWidget bridge, лимиты 32KB/4KB, события) | **Выполнено** | `runtime/browser/widgets.ts`, shadow DOM slot probing в `lab.ts`, `COUNTER_WIDGET_HTML` в `pilots/counter.ts`. |
| 6 | **Изоляция окружений branch environments** (порты, DB, bot pool, worktrees) | **Выполнено** | `runtime/environments/manager.ts`, `process.ts`. Транзакционное выделение портов/ботов, надзор за дочерними процессами без убийства чужих PID. Гарантированный сброс дерева процессов на Windows через `taskkill /pid <PID> /T /F` (без зомби-процессов). |
| 7 | **Детерминированные TypeScript сценарии** (мультиплеер, артефакты, симуляция платежей) | **Выполнено** | `runtime/browser/scenario.ts`. Поддержка шагов `chat.*`, `app.*`, `widget.*`, `payment.simulate`, сохранение JSON и PNG артефактов. |
| 8 | **Веб-интерфейс Next.js Studio & Lab** (`/lab`, задачи, вердикты, артефакты, сессии) | **Выполнено** | `app/lab/page.tsx`, `app/api/lab/route.ts`, `runtime/dashboard/api.ts`. Server-Sent Events (`/api/lab/events`), мгновенная реактивность, фильтрация/поиск задач, управление сессиями Chromium (пауза/продолжить/закрыть), просмотр скриншотов артефактов. |
| 9 | **Generic манифест проектов** (`viewer.project.json`, адаптеры, пилоты) | **Выполнено** | `viewer.project.json`, `schemas/viewer.project.schema.json`, `runtime/pilots/adapters.ts`, пилот `CounterPilot` (`examples/counter/`), безопасная фикстура `adapters/gametycone.fixture.json` и защищенный шаблон `adapters/gametycone.template.json`. |
| 10 | **Значимые тесты без заглушек** (unit, e2e fixtures, concurrency, security) | **Выполнено** | **92 теста проходят** (`npm test`), **`npx tsc --noEmit` без единой ошибки типов**. |

---

## 2. Результаты автоматизированного тестирования

Команда: `npm test`  
Тестовый раннер: встроенный `node --test --import tsx`  
Количество тестов: **92 pass, 0 fail, 0 skipped**  
Проверка типов: `npx tsc --noEmit` — **0 ошибок**

### Покрытие тестовых наборов:
1. `runtime/queue/*.test.ts`:
   - `claim-race.test.ts`: межпроцессная гонка 6 воркеров (гарантия exactly-once).
   - `store.test.ts`: полный жизненный цикл заданий, leases, idempotency, recoverExpired, heartbeats.
   - `redact.test.ts`: очистка секретов (токенов Telegram Bot API, initData, Bearer, Cookie, API-ключей).
   - `legacy-import.test.ts`: детерминированный импорт старых очередей без мутаций исходников.
2. `integrations/devbot/tests/gateway.test.ts`:
   - Атомарная блокировка поллера (`devbot_locks`) с lease expiration.
   - SQLite Inbox и курсор обновлений без потерь.
   - Независимые подтверждения опасных команд.
   - Точная маршрутизация проектов (`/p <id>`).
   - Изоляция по числовым `userId` и private-чатам.
   - Безопасное сохранение файлов с UUID.
   - Персистентный Outbox (отдельная доставка текста и голоса).
   - Идемпотентный CLI миграции.
3. `integrations/antigravity-bridge.test.ts`:
   - Интеграция роута `/api/antigravity-bridge` с реальной SQLite очередью `agent-queue.db`.
   - Идемпотентное создание задач из очереди верстака.
4. `runtime/browser/*.test.ts`:
   - `lab.test.ts`: запуск реального Chromium, persistent контексты, скриншоты, пауза, `pruneArtifacts` (FIFO 24h) и авто-восстановление dead lease.
   - `mcp.test.ts`: инструменты браузерного MCP, регистрация акторов, изоляция origins, пре-популяция 10 testDC + 2 prod акторов.
   - `scenario.test.ts`: многопользовательский сценарий (акторы A и B), кнопки, Shadow DOM виджетов, Mini App запуск/возврат, симуляция оплат.
   - `widgets.test.ts`: проверка сжатия Deflate (до 4KB), размера HTML (до 32KB), запрет внешних скриптов, инъекция моста `TelegramWidget`.
5. `runtime/environments/*.test.ts`:
   - `concurrency.test.ts`: 4 независимых процесса выделяют уникальные порты и соревнуются за ботов.
   - `manager.test.ts`: транзакционное хранилище, изоляция путей, защита от симлинков/переходов.
   - `process.test.ts`: запуск и остановка изолированных дочерних процессов, probe readiness, гарантированный kill дерева процессов на Windows (`taskkill /T /F`).
6. `runtime/pilots/*.test.ts`:
   - `pilots.test.ts`: манифесты `ProjectAdapter`, запрет секретов, пилот `CounterPilot`, `viewer.project.json`.
   - `gametycone.test.ts`: фикстура `gametycone.fixture.json` загружается и привязывается, боевой шаблон `gametycone.template.json` изолирован и блокирует несогласованный запуск (`ADAPTER_NOT_ISOLATED`).
7. `runtime/dashboard/*.test.ts`:
   - `api.test.ts`: защита от Cross-Origin, ограничение размера тела, безопасная отдача артефактов (`.png`, `.json`), управление сессиями браузера.
   - `events.test.ts`: Server-Sent Events (SSE) поток `/api/lab/events`, проверка заголовков и структуры событий.

---

## 3. Инструкция для Claude при передаче в 11:40 MSK

Если вам передается проект в 11:40 для продолжения доработки:
1. **Где находится актуальный код:**
   Каталог: `C:/Users/vovan/Documents/Codex/2026-11-11/new-chat/outputs/Viewer2`  
   Ветка: `viewer2-platform` (синхронизирована с `origin/viewer2-platform`).
2. **Как проверить систему:**
   - Запуск тестов: `npm test` (все 92 теста должны пройти успешно).
   - Проверка типов: `node node_modules/typescript/bin/tsc --noEmit`.
   - Запуск локального сервера Viewer: `npm run viewer:dev` (доступен на `http://127.0.0.1:3100/lab`).
3. **Что уже сделано и НЕ требует переписывания:**
   - Шлюз Telegram Dev Bot (`integrations/devbot/`): переведен на SQLite, проверен и принят координатором (`T-000003` APPROVED), защищен от CPU tight loop.
   - Playwright WebK Runtime (`runtime/browser/`): реализованы сессии, 12 акторов по умолчанию, сценарии, виджеты, Shadow DOM, лимиты кэша.
   - Изоляция сред (`runtime/environments/`): распределение портов и процессов работает, `taskkill` на Windows исключает зомби-процессы.
   - Манифест `viewer.project.json` и фикстуры пилотов (`adapters/`, `examples/counter/`, `runtime/pilots/`).
   - Связка Верстака (`/`) и Очереди Задач (`agent-queue.db`): задачи создаются и обновляются через `/api/antigravity-bridge`.
   - Студия `/lab`: подключены Server-Sent Events (`/api/lab/events`) и фильтры задач.
4. **Рекомендуемый следующий шаг (по желанию пользователя):**
   - Live Cutover реального Telegram Dev Bot с Desktop на новую платформу (см. `docs/telegram-gateway.md`).
   - Запуск GameTycone через внешний headless dev-сервер на выделенном порту.
   - Визуальное расширение компонентов верстака (слои, палитра, deep-links).
