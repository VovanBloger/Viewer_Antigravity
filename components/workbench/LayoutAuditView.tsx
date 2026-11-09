'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Plus,
  Smartphone,
  Volume2,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { LayoutAuditIssue } from '@/lib/antigravity-core';
import { HapticEventRecord } from '@/lib/haptics';
import { TgSimulatedEnv } from '@/components/demo/DemoApp';

interface LayoutAuditViewProps {
  issues: LayoutAuditIssue[];
  isDark: boolean;
  tgEnv: TgSimulatedEnv;
  hapticLogs: HapticEventRecord[];
  onUpdateTgEnv: (patch: Partial<TgSimulatedEnv>) => void;
  onRunAudit: () => void;
  onEnqueueIssue: (issue: LayoutAuditIssue) => void;
  onClearHapticLogs: () => void;
}

export function LayoutAuditView({
  issues,
  isDark,
  tgEnv,
  hapticLogs,
  onUpdateTgEnv,
  onRunAudit,
  onEnqueueIssue,
  onClearHapticLogs,
}: LayoutAuditViewProps) {
  // Accordion states matching Screen 5
  const [openIssues, setOpenIssues] = useState(true);
  const [openTelegram, setOpenTelegram] = useState(false);
  const [openHaptics, setOpenHaptics] = useState(false);

  const borderMuted = isDark ? 'border-[#26262B]' : 'border-zinc-200';
  const cardBg = isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50';

  return (
    <div className="divide-y divide-[#26262B]">
      {/* TOP ACTIONS / AUDIT CONTROLS (MATCHING SCREEN 5 INSPECTOR HEADER) */}
      <div className="pb-2.5 space-y-2">
        {/* Full-width primary audit button */}
        <button
          type="button"
          onClick={onRunAudit}
          title="Запустить мгновенный скан геометрии, Safe Area и тач-зон"
          className={`w-full h-7 px-2.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            isDark
              ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs hover:bg-white'
              : 'bg-zinc-900 text-white font-semibold shadow-xs hover:bg-zinc-800'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Сканировать экран (Аудит вёрстки)</span>
        </button>

        {/* Quick chips / toggles row */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onUpdateTgEnv({ stressOverflowBanner: !tgEnv.stressOverflowBanner });
              setTimeout(onRunAudit, 120);
            }}
            title="Добавить тестовый блок с переполнением по ширине для проверки линтера"
            className={`flex-1 h-6 px-2 rounded border text-[10px] font-mono cursor-pointer transition-colors truncate ${
              tgEnv.stressOverflowBanner
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            {tgEnv.stressOverflowBanner ? 'Скрыть тест-переполнение' : 'Тест: вызвать overflow-x'}
          </button>

          <div
            className={`h-6 px-2 rounded border text-[10px] font-mono flex items-center shrink-0 ${
              issues.length > 0
                ? 'border-rose-500/40 text-rose-300 bg-rose-500/10'
                : 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
            }`}
          >
            {issues.length > 0 ? `Ошибок: ${issues.length}` : 'Чисто (0)'}
          </div>
        </div>
      </div>

      {/* SECTION 1: DETECTED AUDIT ISSUES (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenIssues((v) => !v)}
            title="Свернуть или развернуть список проблем"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openIssues ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
            <span>Проблемы вёрстки</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {issues.length}
            </span>
          </button>
        </div>

        {openIssues && (
          <div className="space-y-2">
            {issues.length === 0 ? (
              <div
                className={`p-4 rounded-lg border text-center space-y-1.5 ${borderMuted} ${cardBg}`}
              >
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
                <div className="text-xs font-semibold text-zinc-200">
                  Геометрия и Safe Area в норме
                </div>
                <p className={`text-[11px] leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>
                  Все элементы укладываются в границы экрана, тач-зоны &ge; 40px, системные отступы соблюдены.
                </p>
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-2.5 rounded-lg border space-y-1.5 ${borderMuted} ${cardBg}`}
                >
                  {/* Top row: Category tag + Title + Enqueue button */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                          issue.severity === 'error'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        }`}
                      >
                        {issue.category === 'overflow-x'
                          ? 'OVERFLOW'
                          : issue.category === 'touch-target'
                          ? 'TOUCH < 40'
                          : 'SAFE-AREA'}
                      </span>
                      <span className="text-xs font-semibold text-zinc-200 truncate">
                        {issue.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onEnqueueIssue(issue)}
                      title="Добавить эту проблему в очередь правок агента Antigravity"
                      className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                        isDark
                          ? 'bg-[#18181C] border-[#27272A] text-purple-300 hover:text-white hover:bg-zinc-800'
                          : 'bg-white border-zinc-200 text-purple-700 hover:bg-zinc-100'
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      <span>В очередь</span>
                    </button>
                  </div>

                  {/* Description */}
                  <p className={`text-[11px] leading-snug break-words ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    {issue.description}
                  </p>

                  {/* Selector & Source File */}
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 pt-0.5">
                    <span className="truncate max-w-[180px]">
                      {issue.selector}
                    </span>
                    {issue.sourceFile && (
                      <span className="text-emerald-400 truncate shrink-0">
                        {issue.sourceFile.split('/').pop()}
                        {issue.sourceLine ? `:${issue.sourceLine}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Suggested fix */}
                  <div className="text-[10px] text-purple-300/90 font-mono bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded">
                    Fix: {issue.suggestedFix}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: TELEGRAM WEBAPP API SIMULATOR (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenTelegram((v) => !v)}
            title="Свернуть или развернуть симулятор Telegram"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openTelegram ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <Smartphone className="w-3.5 h-3.5 text-purple-400" />
            <span>Симулятор Telegram WebApp API</span>
          </button>
        </div>

        {openTelegram && (
          <div className={`p-2.5 rounded-lg border space-y-2 ${borderMuted} ${cardBg}`}>
            {/* ColorScheme control */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-300">
                colorScheme Telegram:
              </span>
              <div className="flex items-center gap-1">
                {(['dark', 'light'] as const).map((scheme) => (
                  <button
                    key={scheme}
                    type="button"
                    onClick={() => onUpdateTgEnv({ colorScheme: scheme })}
                    className={`h-6 px-2.5 rounded border text-[10px] font-mono font-medium cursor-pointer transition-colors ${
                      tgEnv.colorScheme === scheme
                        ? isDark
                          ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                          : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                        : isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                        : 'bg-white border-zinc-200 text-zinc-600'
                    }`}
                  >
                    {scheme}
                  </button>
                ))}
              </div>
            </div>

            {/* Safe Area padding toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-300">
                Отступы Safe Area (pt-safe):
              </span>
              <button
                type="button"
                onClick={() => onUpdateTgEnv({ safeAreaPad: !tgEnv.safeAreaPad })}
                className={`h-6 px-2.5 rounded border text-[10px] font-mono font-medium cursor-pointer transition-colors ${
                  tgEnv.safeAreaPad
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                {tgEnv.safeAreaPad ? 'Включены' : 'Выключены'}
              </button>
            </div>

            {/* Telegram MainButton toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-300">
                Нативная кнопка MainButton:
              </span>
              <button
                type="button"
                onClick={() => onUpdateTgEnv({ mainButtonVisible: !tgEnv.mainButtonVisible })}
                className={`h-6 px-2.5 rounded border text-[10px] font-mono font-medium cursor-pointer transition-colors ${
                  tgEnv.mainButtonVisible
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 font-semibold'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                {tgEnv.mainButtonVisible ? 'Активна (Видна)' : 'Скрыта'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: WEB HAPTICS LOG (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenHaptics((v) => !v)}
            title="Свернуть или развернуть журнал тактильных импульсов"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openHaptics ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <Volume2 className="w-3.5 h-3.5 text-purple-400" />
            <span>Журнал Web Haptics</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {hapticLogs.length}
            </span>
          </button>

          {hapticLogs.length > 0 && (
            <button
              type="button"
              onClick={onClearHapticLogs}
              title="Очистить журнал импульсов"
              className={`h-6 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10'
                  : 'text-zinc-600 hover:text-rose-600'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              <span>Очистить</span>
            </button>
          )}
        </div>

        {openHaptics && (
          <div className="space-y-1.5">
            {hapticLogs.length === 0 ? (
              <div
                className={`p-3 rounded-lg border text-center text-[11px] ${borderMuted} ${cardBg} ${
                  isDark ? 'text-zinc-500' : 'text-zinc-600'
                }`}
              >
                Нажмите любую кнопку или вкладку внутри экрана телефона для генерации Haptic-импульса
              </div>
            ) : (
              <div
                className={`p-2 rounded-lg border max-h-48 overflow-y-auto space-y-1 font-mono text-[10px] scrollbar-thin ${borderMuted} ${cardBg}`}
              >
                {hapticLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between text-zinc-400 hover:text-zinc-200 py-0.5"
                  >
                    <span className="text-purple-400">{log.style}</span>
                    <span>{log.frequencyHz ? `${log.frequencyHz}Hz` : 'AudioSynth'}</span>
                    <span className="text-zinc-500">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
