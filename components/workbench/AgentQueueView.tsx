'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Sparkles,
  RefreshCw,
  FileCode,
  Layers,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import {
  AgentQueueItem,
  SMART_AGENT_DIRECTIVES,
  buildConsolidatedAgentPrompt,
  buildIdeDeepLink,
} from '@/lib/antigravity-core';

interface AgentQueueViewProps {
  queue: AgentQueueItem[];
  isDark: boolean;
  workspaceMeta: { url: string; theme: string; activeDevices: string[] };
  onUpdateItem: (id: string, patch: Partial<AgentQueueItem>) => void;
  onRemoveItem: (id: string) => void;
  onClearQueue: () => void;
  onAddSampleTask: () => void;
}

export function AgentQueueView({
  queue,
  isDark,
  workspaceMeta,
  onUpdateItem,
  onRemoveItem,
  onClearQueue,
  onAddSampleTask,
}: AgentQueueViewProps) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [ideScheme, setIdeScheme] = useState<'antigravity' | 'vscode' | 'cursor'>('antigravity');

  const consolidatedMarkdown = buildConsolidatedAgentPrompt(queue, workspaceMeta);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(consolidatedMarkdown);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2200);
  };

  const handleSyncToWorkspace = async () => {
    setSyncState('syncing');
    try {
      const res = await fetch('/api/antigravity-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue,
          markdownPrompt: consolidatedMarkdown,
          workspaceMeta,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSyncState('synced');
        setLastSyncTime(new Date().toLocaleTimeString('ru-RU'));
        setTimeout(() => setSyncState('idle'), 3000);
      } else {
        setSyncState('error');
      }
    } catch {
      setSyncState('error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* LEFT COLUMN: QUEUED ELEMENTS & DIRECTIVES */}
      <div className="lg:col-span-7 space-y-4">
        <div
          className={`p-5 rounded-2xl border ${
            isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-white/10">
            <div>
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#B833FF]" />
                <span>Пакетная очередь правок для агента Antigravity ({queue.length})</span>
              </h2>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Собирайте несколько элементов с разных экранов в единое техническое задание с точными диффами и ссылками на строки кода
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Протокол открытия IDE"
                value={ideScheme}
                onChange={(e) => setIdeScheme(e.target.value as 'antigravity' | 'vscode' | 'cursor')}
                className={`text-xs font-mono px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                  isDark ? 'bg-[#181828] border-white/10 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-800'
                }`}
              >
                <option value="antigravity">IDE: antigravity://</option>
                <option value="vscode">IDE: vscode://</option>
                <option value="cursor">IDE: cursor://</option>
              </select>

              {queue.length > 0 && (
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Очистить</span>
                </button>
              )}
            </div>
          </div>

          {queue.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <div className="text-sm font-bold">В очереди пока нет зафиксированных элементов</div>
              <p className={`text-xs max-w-md mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Включите инспектор (Alt+I) на вкладке «Холст превью», выберите любой элемент и нажмите «+ В очередь агента», либо загрузите демонстрационный пример задачи.
              </p>
              <button
                type="button"
                onClick={onAddSampleTask}
                className="px-4 py-2 rounded-xl bg-[#B833FF] hover:bg-[#a224e6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Загрузить пример задачи в очередь</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 mt-4">
              {queue.map((item) => {
                const deepLink = buildIdeDeepLink(item.element.sourceFile, item.element.sourceLine, ideScheme);
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-xl border space-y-3 ${
                      isDark ? 'bg-[#161625] border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-[#B833FF] text-white font-mono text-xs font-extrabold flex items-center justify-center shrink-0">
                          #{item.pinNumber}
                        </span>
                        <span className="font-mono text-xs font-bold text-[#B833FF]">
                          &lt;{item.element.tag}&gt;
                        </span>
                        {item.element.componentName && (
                          <span className="text-xs font-semibold truncate">
                            · {item.element.componentName}
                          </span>
                        )}
                        <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          · {item.slotDeviceName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Приоритет пина #${item.pinNumber}`}
                          value={item.priority}
                          onChange={(e) =>
                            onUpdateItem(item.id, { priority: e.target.value as 'high' | 'normal' | 'low' })
                          }
                          className={`text-[11px] font-semibold px-2 py-1 rounded-lg border cursor-pointer ${
                            item.priority === 'high'
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                              : isDark
                              ? 'bg-black/30 border-white/10 text-slate-300'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <option value="high">Высокий приоритет</option>
                          <option value="normal">Обычный приоритет</option>
                          <option value="low">Низкий приоритет</option>
                        </select>

                        {deepLink && (
                          <a
                            href={deepLink}
                            title={`Открыть ${item.element.sourceFile}:${item.element.sourceLine} в IDE`}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-semibold inline-flex items-center gap-1 hover:bg-emerald-500/25"
                          >
                            <FileCode className="w-3 h-3" />
                            <span>
                              {item.element.sourceFile?.split('/').pop()}
                              {item.element.sourceLine ? `:${item.element.sourceLine}` : ''}
                            </span>
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          aria-label={`Удалить пин #${item.pinNumber}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* DIFF TABLE */}
                    {item.diffs.length > 0 && (
                      <div
                        className={`p-2.5 rounded-lg border text-xs font-mono space-y-1 ${
                          isDark ? 'bg-black/40 border-white/5' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="text-[10px] font-sans font-bold text-slate-400 mb-1">
                          Дифф стилей (Было → Стало):
                        </div>
                        {item.diffs.map((d, idx) => (
                          <div key={idx} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-400">{d.property}:</span>
                            <div>
                              <span className="text-rose-400 line-through mr-1.5">{d.before}</span>
                              <span className="text-emerald-400 font-bold">→ {d.after}</span>
                              <span className="ml-2 text-[#D8B4FE]">({d.tailwindSuggestion})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* DIRECTIVE PRESET + NOTE */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Шаблон архитектурной директивы:
                        </label>
                        <select
                          aria-label={`Директива для пина #${item.pinNumber}`}
                          value={item.directiveId || ''}
                          onChange={(e) => onUpdateItem(item.id, { directiveId: e.target.value || undefined })}
                          className={`w-full text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                            isDark ? 'bg-[#11111C] border-white/10 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                          }`}
                        >
                          <option value="">Без шаблона директивы</option>
                          {SMART_AGENT_DIRECTIVES.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Инструкция для агента:
                        </label>
                        <input
                          type="text"
                          value={item.note}
                          onChange={(e) => onUpdateItem(item.id, { note: e.target.value })}
                          placeholder="Что нужно изменить в этом узле..."
                          className={`w-full text-xs px-2.5 py-1.5 rounded-lg border focus:outline-none focus:border-[#B833FF] ${
                            isDark ? 'bg-[#11111C] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: CONSOLIDATED MARKDOWN & LIVE BRIDGE */}
      <div className="lg:col-span-5 space-y-4">
        <div
          className={`p-5 rounded-2xl border flex flex-col h-full ${
            isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-white/10">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#B833FF]" />
                <span>Сводный промпт для чата Antigravity</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Готовый структурированный контекст по всем пинам очереди
              </p>
            </div>
          </div>

          <pre
            className={`flex-1 p-3.5 rounded-xl border font-mono text-xs whitespace-pre-wrap overflow-y-auto max-h-[380px] leading-relaxed ${
              isDark ? 'bg-[#090910] border-white/10 text-slate-200' : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            {consolidatedMarkdown}
          </pre>

          <div className="pt-4 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="py-2.5 px-4 rounded-xl bg-[#B833FF] hover:bg-[#a224e6] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-md"
              >
                {copiedPrompt ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedPrompt ? 'Скопировано в буфер!' : 'Скопировать пакет (Alt+C)'}</span>
              </button>

              <button
                type="button"
                onClick={handleSyncToWorkspace}
                disabled={syncState === 'syncing'}
                className={`py-2.5 px-4 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                  syncState === 'synced'
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : isDark
                    ? 'bg-[#181828] border-white/15 hover:border-[#B833FF] text-slate-100'
                    : 'bg-slate-100 border-slate-300 hover:border-purple-500 text-slate-900'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
                <span>
                  {syncState === 'synced'
                    ? 'Синхронизировано в проект!'
                    : 'Записать в ANTIGRAVITY_TASKS.md'}
                </span>
              </button>
            </div>

            {lastSyncTime && (
              <div className="text-[11px] font-mono text-emerald-400 text-center">
                Контекст записан в .antigravity-viewer-context.json и ANTIGRAVITY_TASKS.md в {lastSyncTime}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
