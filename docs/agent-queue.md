# Очередь заданий для агентов (Viewer 2, этапы 1–2)

Координатор (**Codex** или **Claude**) ставит задание → ожидающая беседа **Antigravity**
получает его, выполняет и сдаёт отчёт → координатор выносит вердикт.

```
Codex / Claude ──MCP──► очередь (SQLite) ◄──ожидатель── беседа Antigravity (Gemini Flash)
        ▲                                                        │
        └──────────── отчёт, вердикт, возврат на исправление ◄───┘
```

Код — в `runtime/`:

| Путь | Назначение |
|---|---|
| `runtime/queue/types.ts` | Контракт: задание, отчёт, вердикт, интерфейс хранилища |
| `runtime/queue/store.ts` | Хранилище на встроенном `node:sqlite` (WAL, атомарные транзакции) |
| `runtime/queue/redact.ts` | Вырезание секретов из всего, что уходит моделям |
| `runtime/queue/legacy-import.ts` | Импорт очереди Antigravity Dev Bot (только чтение) |
| `runtime/mcp/server.ts` | MCP-сервер `viewer-agents` для координаторов |
| `runtime/cli/wait-task.ts` | Ожидатель для беседы-исполнителя |
| `runtime/cli/task.ts` | CLI исполнителя и оператора |

База общая для всех клонов и worktree: `~/.viewer-antigravity/agent-queue.db`
(переопределяется переменной `VIEWER_QUEUE_DB` или опцией `--db=`).

## Чем это отличается от старого моста

| Было (Dev Bot) | Стало |
|---|---|
| Общий `queue.json` без блокировок — потеря заданий и двойная выдача | SQLite, каждая операция в `BEGIN IMMEDIATE` |
| Неизвестный проект → «активный проект» | Ошибка `UNKNOWN_PROJECT`, без нечёткого поиска |
| Нет владельца задания | Владелец, срок владения, heartbeat, остановка при потере исполнителя без повторной выдачи |
| Отчёт всегда уходит в Telegram + TTS | Уведомления — отдельный outbox, по умолчанию выключены |
| Одобрение сливает ветку в `master` | `approve` только меняет статус |
| Ревью жёстко через `claude -p` | Координатор — любая сессия с доступом к MCP |

Действующий Dev Bot не изменён и продолжает работать как раньше.

## Жизненный цикл

```
QUEUED ─claim─► IN_PROGRESS ─report─► REPORTED ─approve─► APPROVED
   ▲                │                     │
   │                ├─ fail ─► FAILED     └─ request_changes ─► QUEUED (round + 1)
   └─ срок владения истёк → FAILED / EXECUTOR_LOST               после 2 раундов ─► RETURNED
      повторный запуск требует решения координатора
cancel: QUEUED / REPORTED ─► CANCELLED сразу; IN_PROGRESS ─► флаг, исполнитель видит его в heartbeat
```

## Быстрый старт

```bash
npm install
```

Зарегистрировать проект (один раз):

```bash
npm run --silent agents:task -- projects add --id=viewer --name="Viewer Antigravity" --path="C:/Users/vovan/Desktop/Viewer Antigravity"
```

Либо перенести проекты и историю из Dev Bot (исходные файлы не изменяются, повторный запуск ничего не дублирует):

```bash
npm run --silent agents:task -- import-legacy --file="C:/Users/vovan/Desktop/Antigravity Dev Bot/data/queue.json" --projects="C:/Users/vovan/Desktop/Antigravity Dev Bot/config/projects.config.json"
```

### Исполнитель — Antigravity

В выделенной беседе выбрать Gemini 3.8 Flash и вызвать `/agents <projectId>`
(навык: `.agents/skills/agents/SKILL.md`). Под капотом:

```bash
npm run --silent agents:wait -- --project=viewer
```

### Координатор — Claude Code

Добавить в корень репозитория `.mcp.json`:

```json
{
  "mcpServers": {
    "viewer-agents": {
      "command": "node",
      "args": ["--import", "tsx", "runtime/mcp/server.ts"]
    }
  }
}
```

### Координатор — Codex

В `~/.codex/config.toml`:

```toml
[mcp_servers.viewer-agents]
command = "node"
args = ["--import", "tsx", "runtime/mcp/server.ts"]
cwd = "C:/Users/vovan/Desktop/Viewer Antigravity"
```

### Инструменты MCP

| Инструмент | Результат |
|---|---|
| `submit_agent_task` | Поставить задание с критериями готовности |
| `get_agent_task` | Состояние, краткий прогресс, последние события |
| `wait_agent_task` | Дождаться изменения без опроса моделью |
| `cancel_agent_task` | Запросить остановку |
| `submit_verdict` | Принять результат или вернуть замечания (ничего не сливает и не деплоит) |
| `list_agent_tasks`, `list_projects` | Обзор |

## Диагностическое задание (приёмка этапа 1)

1. В Antigravity: `/agents viewer`.
2. Координатор вызывает `submit_agent_task`:
   `projectId: "viewer"`, `kind: "diagnostic"`, `title: "Проверка моста"`,
   `goal: "Выполни node --version и git rev-parse HEAD, ничего не меняй"`,
   `acceptance: ["В отчёте есть версия Node и текущая ревизия"]`, `coordinatorId: "codex"`.
3. `wait_agent_task` возвращает `REPORTED` → `submit_verdict` с `approve`.
4. Беседа Antigravity снова стоит в ожидании.

## Что дальше по плану

- **Этап 3 — рой:** несколько ожидателей/worktree, проверка фактической модели.
- **Этап 4 — Telegram-тестирование:** Playwright + Telegram WebK, пул аккаунтов тестовой сети.
- **Этап 5 — интерфейс Viewer:** панель заданий и сессий; замена `app/api/antigravity-bridge`.
- Переключение Dev Bot на эту очередь (отправка уведомлений из outbox).

