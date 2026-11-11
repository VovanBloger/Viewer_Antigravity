'use client';

import { useCallback, useEffect, useState } from 'react';

type Task = { id: string; title: string; projectId: string; status: string; progress: string; owner?: string; cancelRequested?: boolean; report?: { summary: string; revision?: string; checks: { command: string; ok: boolean; details?: string }[]; artifacts: { path: string; note?: string }[]; openQuestions: string[] }; verdicts: { notes?: string }[] };
type Project = { id: string; name: string };
const terminal = ['APPROVED', 'FAILED', 'CANCELLED', 'RETURNED'];

export default function Lab() {
  const [tasks, setTasks] = useState<Task[]>([]), [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [project, setProject] = useState(''), [title, setTitle] = useState(''), [goal, setGoal] = useState(''), [acceptance, setAcceptance] = useState(''), [notes, setNotes] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/lab', { cache: 'no-store' }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message);
      setTasks(data.tasks); setProjects(data.projects); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Нет связи с очередью'); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 3000); return () => clearInterval(timer); }, [load]);
  async function action(body: object) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/lab', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message);
      if (data.task) setSelected(data.task.id);
      await load(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); return false; } finally { setBusy(false); }
  }
  const task = tasks.find(t => t.id === selected);
  const input = 'w-full rounded-lg border border-white/15 bg-white/5 p-3 text-sm';
  const button = 'rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-40 hover:bg-white/10';
  return <main className="min-h-screen bg-[#0b1018] p-6 text-slate-100 md:p-10">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><a href="/" className="text-sm text-slate-400">← Viewer Workbench</a><h1 className="mt-3 text-3xl font-semibold">Telegram Development Lab</h1><p className="mt-2 text-slate-400">Общая очередь Codex, Claude, Antigravity и Telegram</p></div><button className={button} onClick={() => void load()}>Обновить</button></header>
    {error && <p role="alert" className="mb-5 rounded-lg border border-red-400/40 bg-red-400/10 p-4">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
      <form className="space-y-4 rounded-xl border border-white/10 p-5" onSubmit={e => { e.preventDefault(); void action({ action: 'submit', projectId: project, title, goal, acceptance: acceptance.split('\n').filter(Boolean), idempotencyKey: crypto.randomUUID() }).then(ok => { if (ok) { setTitle(''); setGoal(''); setAcceptance(''); } }); }}>
        <h2 className="text-xl">Новое задание</h2>
        <label className="block">Проект<select className={input} required value={project} onChange={e => setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block">Название<input className={input} required value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="block">Задача<textarea className={input} rows={5} required value={goal} onChange={e => setGoal(e.target.value)} /></label>
        <label className="block">Критерии готовности<textarea className={input} rows={3} placeholder="Один критерий на строку" required value={acceptance} onChange={e => setAcceptance(e.target.value)} /></label>
        <button className={button} disabled={busy}>Поставить в очередь</button>
        <p className="text-xs text-slate-400">Результат поступит на ревью. Принятие отчёта не запускает слияние или деплой.</p>
      </form>
      <section className="space-y-5"><div className="overflow-auto rounded-xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr><th className="p-3">Задание</th><th>Проект</th><th>Состояние</th><th className="p-3">Исполнитель</th></tr></thead><tbody>{tasks.map(t => <tr key={t.id} className={selected === t.id ? 'bg-cyan-400/10' : 'border-t border-white/5'}><td className="p-3"><button className="text-left hover:text-cyan-300" onClick={() => setSelected(t.id)}><span className="block text-xs text-slate-500">{t.id}</span>{t.title}</button></td><td>{t.projectId}</td><td>{t.status}{t.cancelRequested ? ' · остановка запрошена' : ''}</td><td className="p-3 text-slate-400">{t.owner || 'Ожидает'}</td></tr>)}</tbody></table>{tasks.length === 0 && <p className="p-6 text-slate-400">Заданий пока нет.</p>}</div>
        {task && <article className="space-y-4 rounded-xl border border-white/10 p-5"><h2 className="text-xl">{task.id} · {task.title}</h2><p className="text-slate-400">{task.progress}</p>{task.report && <><p className="whitespace-pre-wrap">{task.report.summary}</p>{task.report.revision && <p className="font-mono text-xs">Ревизия: {task.report.revision}</p>}<ul>{task.report.checks.map((c,i) => <li key={i} className="mb-2"><span className={c.ok ? 'text-emerald-400' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span> {c.command}<pre className="whitespace-pre-wrap text-xs text-slate-400">{c.details}</pre></li>)}</ul>{task.report.artifacts.map((a,i) => <p key={i} className="break-all text-sm text-slate-400">Артефакт: {a.path} {a.note}</p>)}{task.report.openQuestions.map((q,i) => <p key={i} className="text-amber-300">{q}</p>)}</>}
          {task.status === 'REPORTED' && <><label className="block">Замечания<textarea className={input} value={notes} onChange={e => setNotes(e.target.value)} /></label><div className="flex gap-3"><button className={button} disabled={busy} onClick={() => void action({ action:'verdict',taskId:task.id,decision:'approve',notes })}>Принять отчёт</button><button className={button} disabled={busy || !notes.trim()} onClick={() => void action({ action:'verdict',taskId:task.id,decision:'request_changes',notes })}>Вернуть на исправление</button></div></>}
          {!terminal.includes(task.status) && <button className={button} disabled={busy || task.cancelRequested} onClick={() => void action({ action:'cancel',taskId:task.id })}>Остановить задание</button>}
        </article>}
      </section>
    </div>
  </main>;
}
