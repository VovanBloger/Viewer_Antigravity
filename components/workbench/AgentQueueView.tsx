'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Trash2,
  RefreshCw,
  FileCode,
  Layers,
  Plus,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Sparkles,
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

  // Accordion open states matching Screen 5
  const [openQueue, setOpenQueue] = useState(true);
  const [openPrompt, setOpenPrompt] = useState(false);

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

  const borderMuted = isDark ? 'border-[#26262B]' : 'border-zinc-200';
  const cardBg = isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50';
  const inputClass = isDark
    ? 'bg-[#0E0E11] border-[#27272A] text-zinc-100 focus:border-zinc-400'
    : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-600';

  return (
    <div className="divide-y divide-[#26262B]">
      {/* TOP ACTIONS / SUMMARY HEADER (MATCHING SCREEN 5 INSPECTOR HEADER) */}
      <div className="pb-2.5 space-y-2">
        {/* Full-width primary action button */}
        <button
          type="button"
          onClick={handleCopyPrompt}
          title="Скопировать все задачи очереди в буфер обмена для агента (Alt+C)"
          className={`w-full h-7 px-2.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            copiedPrompt
              ? 'bg-emerald-500 text-white font-semibold shadow-xs'
              : isDark
              ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs hover:bg-white'
              : 'bg-zinc-900 text-white font-semibold shadow-xs hover:bg-zinc-800'
          }`}
        >
          {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedPrompt ? 'Скопировано в буфер!' : 'Скопировать пакет задач (Alt+C)'}</span>
        </button>

        {/* Quick actions chips row */}
        <div className="grid grid-cols-12 gap-1">
          <button
            type="button"
            onClick={handleSyncToWorkspace}
            disabled={syncState === 'syncing'}
            title="Записать очередь правок в ANTIGRAVITY_TASKS.md"
            className={`col-span-7 h-6 px-2 rounded border text-[10px] font-mono font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors truncate ${
              syncState === 'synced'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:text-white hover:bg-zinc-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            <RefreshCw className={`w-3 h-3 shrink-0 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
            <span className="truncate">
              {syncState === 'synced'
                ? 'Сохранено в проект!'
                : syncState === 'syncing'
                ? 'Запись...'
                : 'Записать в проект'}
            </span>
          </button>

          <select
            aria-label="Протокол открытия IDE"
            value={ideScheme}
            onChange={(e) => setIdeScheme(e.target.value as 'antigravity' | 'vscode' | 'cursor')}
            className={`col-span-3 h-6 px-1 rounded border text-[10px] font-mono cursor-pointer truncate ${
              isDark ? 'bg-[#18181C] border-[#27272A] text-zinc-300' : 'bg-white border-zinc-200 text-zinc-700'
            }`}
          >
            <option value="antigravity">AGY</option>
            <option value="vscode">VSCode</option>
            <option value="cursor">Cursor</option>
          </select>

          {queue.length > 0 ? (
            <button
              type="button"
              onClick={onClearQueue}
              title="Очистить все пины очереди"
              className="col-span-2 h-6 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/15 flex items-center justify-center cursor-pointer transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onAddSampleTask}
              title="Добавить пример задачи"
              className={`col-span-2 h-6 rounded border text-[10px] flex items-center justify-center cursor-pointer transition-colors ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                  : 'bg-white border-zinc-200 text-zinc-600'
              }`}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        {lastSyncTime && (
          <div className="text-[10px] font-mono text-emerald-400 text-center truncate">
            ✓ Синхронизировано в ANTIGRAVITY_TASKS.md в {lastSyncTime}
          </div>
        )}
      </div>

      {/* SECTION 1: QUEUED ITEMS (MATCHING ACCORDION IN SCREEN 5) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenQueue((v) => !v)}
            title="Свернуть или развернуть список задач очереди"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openQueue ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>Элементы очереди</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {queue.length}
            </span>
          </button>

          {queue.length === 0 && (
            <button
              type="button"
              onClick={onAddSampleTask}
              title="Загрузить демонстрационную задачу в очередь"
              className={`h-6 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Plus className="w-3 h-3" />
              <span>Пример</span>
            </button>
          )}
        </div>

        {openQueue && (
          <div className="space-y-2">
            {queue.length === 0 ? (
              <div
                className={`p-4 rounded-lg border text-center space-y-2 ${borderMuted} ${cardBg}`}
              >
                <div className="text-xs font-medium text-zinc-300">
                  В очереди пока нет элементов
                </div>
                <p className={`text-[11px] leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>
                  Включите инспектор (Alt+I), выберите элемент на макете и нажмите «+ В очередь агента», либо загрузите пример:
                </p>
                <button
                  type="button"
                  onClick={onAddSampleTask}
                  className={`h-7 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    isDark
                      ? 'bg-[#18181C] border border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                      : 'bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  <span>Загрузить пример задачи</span>
                </button>
              </div>
            ) : (
              queue.map((item) => {
                const deepLink = buildIdeDeepLink(
                  item.element.sourceFile,
                  item.element.sourceLine,
                  ideScheme
                );
                return (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-lg border space-y-2 ${borderMuted} ${cardBg}`}
                  >
                    {/* Header line: Pin badge + Tag + Component name + Device + Delete */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                          #{item.pinNumber}
                        </span>
                        <span className="font-mono text-xs font-semibold text-purple-400">
                          &lt;{item.element.tag}&gt;
                        </span>
                        {item.element.componentName && (
                          <span className="text-xs text-zinc-200 font-medium truncate">
                            {item.element.componentName}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[80px]">
                          {item.slotDeviceName}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          title={`Удалить пин #${item.pinNumber}`}
                          className="text-zinc-500 hover:text-rose-400 p-0.5 rounded cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Controls row: Priority & IDE deep link */}
                    <div className="flex items-center justify-between gap-1.5">
                      <select
                        aria-label={`Приоритет пина #${item.pinNumber}`}
                        value={item.priority}
                        onChange={(e) =>
                          onUpdateItem(item.id, {
                            priority: e.target.value as 'high' | 'normal' | 'low',
                          })
                        }
                        className={`h-6 px-1.5 rounded border text-[10px] font-medium cursor-pointer ${
                          item.priority === 'high'
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                            : isDark
                            ? 'bg-[#18181C] border-[#27272A] text-zinc-300'
                            : 'bg-white border-zinc-200 text-zinc-700'
                        }`}
                      >
                        <option value="high">Высокий</option>
                        <option value="normal">Обычный</option>
                        <option value="low">Низкий</option>
                      </select>

                      {deepLink && (
                        <a
                          href={deepLink}
                          title={`Открыть ${item.element.sourceFile}:${item.element.sourceLine} в IDE`}
                          className={`h-6 px-2 rounded border text-[10px] font-mono text-emerald-400 flex items-center gap-1 hover:text-emerald-300 ${
                            isDark
                              ? 'bg-[#18181C] border-[#27272A]'
                              : 'bg-white border-zinc-200'
                          }`}
                        >
                          <FileCode className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[120px]">
                            {item.element.sourceFile?.split('/').pop()}
                            {item.element.sourceLine ? `:${item.element.sourceLine}` : ''}
                          </span>
                          <ArrowUpRight className="w-2.5 h-2.5 shrink-0 opacity-70" />
                        </a>
                      )}
                    </div>

                    {/* Diff box if present */}
                    {item.diffs.length > 0 && (
                      <div
                        className={`p-2 rounded border text-[10px] font-mono space-y-1 ${
                          isDark ? 'bg-[#121216] border-[#27272A]' : 'bg-white border-zinc-200'
                        }`}
                      >
                        <div className="text-zinc-500 font-semibold mb-0.5">
                          Дифф стилей (Было → Стало):
                        </div>
                        {item.diffs.map((d, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-1">
                            <span className="text-zinc-400 truncate">{d.property}:</span>
                            <div className="shrink-0">
                              <span className="text-rose-400 line-through mr-1">{d.before}</span>
                              <span className="text-emerald-400 font-semibold">→ {d.after}</span>
                              {d.tailwindSuggestion && (
                                <span className="ml-1 text-purple-400">({d.tailwindSuggestion})</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Directive selector & instruction input */}
                    <div className="space-y-1">
                      <select
                        aria-label={`Директива для пина #${item.pinNumber}`}
                        value={item.directiveId || ''}
                        onChange={(e) =>
                          onUpdateItem(item.id, { directiveId: e.target.value || undefined })
                        }
                        className={`w-full h-6 px-1.5 rounded border text-[10px] cursor-pointer truncate ${inputClass}`}
                      >
                        <option value="">Без шаблона директивы</option>
                        {SMART_AGENT_DIRECTIVES.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={item.note}
                        onChange={(e) => onUpdateItem(item.id, { note: e.target.value })}
                        placeholder="Инструкция для агента Antigravity..."
                        className={`w-full h-6 px-2 rounded border text-[11px] focus:outline-none placeholder:text-zinc-600 ${inputClass}`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: CONSOLIDATED MARKDOWN PROMPT (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenPrompt((v) => !v)}
            title="Свернуть или развернуть сводный промпт"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openPrompt ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Сводный Markdown-промпт</span>
          </button>

          <button
            type="button"
            onClick={handleCopyPrompt}
            title="Копировать текст промпта"
            className={`h-6 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 cursor-pointer ${
              isDark
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Copy className="w-3 h-3" />
            <span>Копировать</span>
          </button>
        </div>

        {openPrompt && (
          <div className="space-y-1.5">
            <pre
              className={`p-2.5 rounded-lg border font-mono text-[11px] leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap select-text scrollbar-thin ${borderMuted} ${
                isDark ? 'bg-[#0E0E11] text-zinc-300' : 'bg-zinc-900 text-zinc-100'
              }`}
            >
              {consolidatedMarkdown}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
