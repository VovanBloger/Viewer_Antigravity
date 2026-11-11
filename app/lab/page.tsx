'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Task = {
  id: string;
  title: string;
  goal: string;
  projectId: string;
  status: string;
  version: number;
  progress: string;
  owner?: string;
  cancelRequested?: boolean;
  failure?: { code: string; reason: string };
  report?: {
    summary: string;
    revision?: string;
    changedFiles: string[];
    checks: { command: string; ok: boolean; details?: string }[];
    artifacts: { path: string; note?: string; type?: string }[];
    openQuestions: string[];
  };
  verdicts: { decision: string; notes?: string; by: string; at: string }[];
};

type TaskEvent = { at: string; type: string; actor: string };
type Project = { id: string; name: string };
type BrowserSession = { id: string; actorId: string; owner: string; projectId: string; network: string; paused: boolean; mode: string };

const terminal = ['APPROVED', 'FAILED', 'CANCELLED', 'RETURNED'];

export default function Lab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [project, setProject] = useState('');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [notes, setNotes] = useState('');

  const submitKey = useRef<{ payload: string; key: string } | null>(null);
  const refresh = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++refresh.current;
    try {
      const response = await fetch('/api/lab', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message);
      if (sequence !== refresh.current) return;
      setTasks(data.tasks || []);
      setProjects(data.projects || []);
      if (data.sessions) setSessions(data.sessions);
      setLoadError('');
      setLoaded(true);
    } catch (e) {
      if (sequence === refresh.current) setLoadError(e instanceof Error ? e.message : 'Нет связи с очередью');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const selectedVersion = tasks.find(t => t.id === selected)?.version;

  useEffect(() => {
    setNotes('');
    setError('');
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setEvents([]);
    if (selected) {
      void fetch(`/api/lab?id=${encodeURIComponent(selected)}`, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || data.message);
          if (!controller.signal.aborted) setEvents(data.events || []);
        })
        .catch(e => {
          if (!controller.signal.aborted) setLoadError(e instanceof Error ? e.message : 'Не удалось получить историю');
        });
    }
    return () => controller.abort();
  }, [selected, selectedVersion]);

  async function action(body: object) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/lab', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message);
      if (data.task) setSelected(data.task.id);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      void load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const body = {
      action: 'submit',
      projectId: project,
      title: title.trim(),
      goal: goal.trim(),
      acceptance: acceptance.split('\n').map(a => a.trim()).filter(Boolean)
    };
    const payload = JSON.stringify(body);
    if (!submitKey.current || submitKey.current.payload !== payload) {
      submitKey.current = { payload, key: crypto.randomUUID() };
    }
    if (await action({ ...body, idempotencyKey: submitKey.current.key })) {
      submitKey.current = null;
      setTitle('');
      setGoal('');
      setAcceptance('');
    }
  }

  const task = tasks.find(t => t.id === selected);
  const input = 'w-full rounded-lg border border-white/15 bg-white/5 p-3 text-sm focus:border-cyan-400 focus:outline-none';
  const button = 'rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-40 hover:bg-white/10 transition-colors';
  const buttonCyan = 'rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-cyan-500 transition-colors';

  return (
    <main className="min-h-screen bg-[#0b1018] p-6 text-slate-100 md:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <a href="/" className="hover:text-white">← Viewer Workbench</a>
            <span>•</span>
            <a href="/demo" className="hover:text-white">Demo App</a>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Telegram Development Lab</h1>
          <p className="mt-2 text-slate-400">Общая платформа и очередь: Codex, Claude, Antigravity, Telegram Gateway & Browser Studio</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Queue Live
          </span>
          <button className={button} onClick={() => void load()}>Обновить</button>
        </div>
      </header>

      {(error || loadError) && (
        <p role="alert" className="mb-5 rounded-lg border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">
          {error || loadError}
        </p>
      )}

      {sessions.length > 0 && (
        <section className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-medium text-white mb-3">Активные сессии Chromium (Telegram WebK)</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map(s => (
              <div key={s.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-cyan-300 font-medium">{s.actorId}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${s.paused ? 'bg-amber-400/20 text-amber-300' : 'bg-emerald-400/20 text-emerald-300'}`}>
                    {s.paused ? 'Пауза (Human)' : 'Активна'}
                  </span>
                </div>
                <div className="text-slate-400 space-y-1">
                  <p>Проект: <span className="text-white">{s.projectId}</span></p>
                  <p>Сеть: <span className="text-white">{s.network}</span> • Режим: {s.mode}</p>
                  <p>Владелец: {s.owner}</p>
                </div>
                <div className="flex gap-2 pt-2 border-t border-white/10">
                  {s.paused ? (
                    <button className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded" onClick={() => void action({ action: 'browser_resume', sessionId: s.id, owner: s.owner })}>
                      Продолжить
                    </button>
                  ) : (
                    <button className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded" onClick={() => void action({ action: 'browser_pause', sessionId: s.id, owner: s.owner })}>
                      Пауза
                    </button>
                  )}
                  <button className="px-2 py-1 bg-red-500/20 text-red-300 hover:bg-red-500/30 rounded" onClick={() => void action({ action: 'browser_close', sessionId: s.id, owner: s.owner })}>
                    Закрыть
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <form className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 h-fit" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <h2 className="text-xl font-medium">Новое задание</h2>
          <label className="block text-sm">
            <span className="text-slate-300 mb-1 block">Проект</span>
            <select className={input} required value={project} onChange={e => setProject(e.target.value)}>
              <option value="">Выберите проект</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300 mb-1 block">Название</span>
            <input className={input} required value={title} onChange={e => setTitle(e.target.value)} placeholder="Краткое название задачи" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300 mb-1 block">Задача</span>
            <textarea className={input} rows={5} required value={goal} onChange={e => setGoal(e.target.value)} placeholder="Подробное описание задачи для агента..." />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300 mb-1 block">Критерии готовности</span>
            <textarea className={input} rows={3} placeholder="Один критерий на строку" required value={acceptance} onChange={e => setAcceptance(e.target.value)} />
          </label>
          <button className={buttonCyan} disabled={busy || !project || !title.trim() || !goal.trim() || !acceptance.trim()}>
            Поставить в очередь
          </button>
          <p className="text-xs text-slate-400">
            Результат поступит на проверку координатора. Принятие отчёта не запускает слияние или деплой.
          </p>
        </form>

        <section className="space-y-5">
          <div className="overflow-auto rounded-xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-sm">
              <caption className="p-3 text-left text-xs text-slate-400">Последние 100 заданий · новые сверху</caption>
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="p-3">Задание</th>
                  <th>Проект</th>
                  <th>Состояние</th>
                  <th className="p-3">Исполнитель</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => (
                  <tr key={t.id} className={selected === t.id ? 'bg-cyan-400/10' : 'border-t border-white/5 hover:bg-white/[0.02]'}>
                    <td className="p-3">
                      <button className="text-left hover:text-cyan-300" onClick={() => setSelected(t.id)}>
                        <span className="block text-xs font-mono text-slate-500">{t.id}</span>
                        <span className="font-medium">{t.title}</span>
                      </button>
                    </td>
                    <td><span className="rounded bg-white/5 px-2 py-0.5 text-xs font-mono">{t.projectId}</span></td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                        t.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300' :
                        t.status === 'REPORTED' ? 'bg-amber-500/20 text-amber-300' :
                        t.status === 'FAILED' ? 'bg-red-500/20 text-red-300' :
                        t.status === 'CLAIMED' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-slate-300'
                      }`}>
                        {t.status}{t.cancelRequested ? ' · отмена' : ''}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400 font-mono text-xs">{terminal.includes(t.status) ? 'Завершено' : t.owner || 'Ожидает'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tasks.length === 0 && (
              <p className="p-6 text-slate-400">
                {loaded ? 'Заданий пока нет. Выберите проект и поставьте первое задание.' : 'Загрузка очереди…'}
              </p>
            )}
          </div>

          {task && (
            <article className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                  <span className="font-mono text-xs text-cyan-400">{task.id}</span>
                  <h2 className="text-2xl font-semibold mt-1">{task.title}</h2>
                </div>
                <span className={`px-3 py-1 rounded text-xs font-medium ${
                  task.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300' :
                  task.status === 'REPORTED' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-slate-300'
                }`}>
                  {task.status}
                </span>
              </div>

              <p className="text-slate-300 text-sm">{task.progress}</p>

              {task.report && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-4">
                  <h3 className="font-medium text-white text-sm">Отчёт исполнителя</h3>
                  <p className="whitespace-pre-wrap text-sm text-slate-200">{task.report.summary}</p>
                  {task.report.revision && <p className="font-mono text-xs text-cyan-300">Ревизия commit: {task.report.revision}</p>}

                  {task.report.checks.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Проверки</h4>
                      <ul className="space-y-2">
                        {task.report.checks.map((c, i) => (
                          <li key={i} className="text-xs">
                            <span className={c.ok ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                              {c.ok ? '✓ PASS' : '✗ FAIL'}
                            </span>{' '}
                            <code className="text-slate-300">{c.command}</code>
                            {c.details && <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-400 bg-white/5 p-2 rounded">{c.details}</pre>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {task.report.artifacts.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Артефакты</h4>
                      <div className="space-y-3">
                        {task.report.artifacts.map((a, i) => {
                          const name = (a.path || a.note || '').split(/[\\/]/).pop() || '';
                          const isPng = name.toLowerCase().endsWith('.png');
                          return (
                            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                              <p className="break-all font-mono text-xs text-slate-300">
                                {a.path} {a.note ? `— ${a.note}` : ''}
                              </p>
                              {isPng && (
                                <div className="mt-2">
                                  <img
                                    src={`/api/lab?artifact=${encodeURIComponent(name)}`}
                                    alt="Скриншот артефакта"
                                    className="max-h-96 rounded border border-white/20 object-contain bg-black/40"
                                    onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {task.report.openQuestions.length > 0 && (
                    <div className="rounded border border-amber-400/30 bg-amber-400/10 p-3">
                      <h4 className="text-xs font-semibold text-amber-300 mb-1">Открытые вопросы:</h4>
                      {task.report.openQuestions.map((q, i) => <p key={i} className="text-xs text-amber-200">{q}</p>)}
                    </div>
                  )}
                </div>
              )}

              <details className="rounded-lg border border-white/10 bg-white/[0.01] p-3">
                <summary className="cursor-pointer text-sm text-slate-400 hover:text-white">Исходная задача</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{task.goal}</p>
              </details>

              {task.failure && (
                <div className="whitespace-pre-wrap rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
                  <span className="font-bold">{task.failure.code}:</span> {task.failure.reason}
                </div>
              )}

              {task.report?.changedFiles && task.report.changedFiles.length > 0 && (
                <details className="rounded-lg border border-white/10 bg-white/[0.01] p-3">
                  <summary className="cursor-pointer text-sm text-slate-400 hover:text-white">
                    Изменённые файлы ({task.report.changedFiles.length})
                  </summary>
                  <ul className="mt-2 break-all font-mono text-xs text-slate-400 space-y-1">
                    {task.report.changedFiles.map((file, i) => <li key={i}>• {file}</li>)}
                  </ul>
                </details>
              )}

              {task.verdicts.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-slate-400">Замечания и решения координатора</h3>
                  {task.verdicts.map((v, i) => (
                    <div key={i} className="rounded-lg bg-white/5 p-3 text-sm">
                      <p className="text-xs text-slate-400">
                        <span className="font-medium text-slate-300">{v.by}</span> • {v.decision} • {new Date(v.at).toLocaleString('ru-RU')}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-200">{v.notes || 'Без замечаний'}</p>
                    </div>
                  ))}
                </section>
              )}

              {task.status === 'REPORTED' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <h3 className="text-sm font-medium text-amber-300">Оценка отчёта координатором</h3>
                  <label className="block">
                    <span className="text-xs text-slate-300 mb-1 block">Замечания к выполнению</span>
                    <textarea className={input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Замечания или требования к доработке..." />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button className={buttonCyan} disabled={busy} onClick={() => void action({ action: 'verdict', taskId: task.id, version: task.version, decision: 'approve', notes })}>
                      Принять отчёт (Approve)
                    </button>
                    <button className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/30 disabled:opacity-40" disabled={busy || !notes.trim()} onClick={() => void action({ action: 'verdict', taskId: task.id, version: task.version, decision: 'request_changes', notes })}>
                      Вернуть на исправление
                    </button>
                  </div>
                </div>
              )}

              {!terminal.includes(task.status) && (
                <button className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-40" disabled={busy || task.cancelRequested} onClick={() => void action({ action: 'cancel', taskId: task.id, version: task.version })}>
                  Остановить задание
                </button>
              )}

              {events.length > 0 && (
                <details className="rounded-lg border border-white/10 bg-white/[0.01] p-3">
                  <summary className="cursor-pointer text-sm text-slate-400 hover:text-white">История событий ({events.length})</summary>
                  <ol className="mt-2 space-y-1 text-xs text-slate-400 font-mono">
                    {events.map((event, i) => (
                      <li key={i}>
                        {new Date(event.at).toLocaleTimeString('ru-RU')} • {event.type} • {event.actor}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
