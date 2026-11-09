'use client';

import React from 'react';
import { ShieldAlert, CheckCircle2, RefreshCw, Plus, Activity, Smartphone, Volume2 } from 'lucide-react';
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
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* LEFT: AUTOMATED LAYOUT & SAFE-AREA LINTER */}
      <div className="lg:col-span-7 space-y-4">
        <div
          className={`p-5 rounded-2xl border ${
            isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-white/10">
            <div>
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#B833FF]" />
                <span>Автоматический линтер мобильной вёрстки (Layout & Safe Area Audit)</span>
              </h2>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Сканирует DOM активного экрана на горизонтальное переполнение (overflow-x), мелкие кнопки (&lt; 40px) и конфликты с системными зонами Telegram
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onUpdateTgEnv({ stressOverflowBanner: !tgEnv.stressOverflowBanner });
                  setTimeout(onRunAudit, 120);
                }}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                  tgEnv.stressOverflowBanner
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : isDark
                    ? 'bg-[#181828] border-white/10 text-slate-300 hover:border-amber-400'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                {tgEnv.stressOverflowBanner ? 'Скрыть тест-переполнение' : 'Тест: вызвать переполнение'}
              </button>

              <button
                type="button"
                onClick={onRunAudit}
                className="px-3.5 py-1.5 rounded-xl bg-[#B833FF] hover:bg-[#a224e6] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Сканировать экран</span>
              </button>
            </div>
          </div>

          {issues.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-bold">Проблем с геометрией и Safe Area не обнаружено</div>
              <p className={`text-xs max-w-md mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Все интерактивные элементы соответствуют мобильным стандартам, а ширина узлов не превышает границы экрана. Нажмите «Тест: вызвать переполнение», чтобы проверить работу сканера.
              </p>
            </div>
          ) : (
            <div className="space-y-3 mt-4">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-4 rounded-xl border space-y-2 ${
                    isDark ? 'bg-[#161625] border-white/10' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                          issue.severity === 'error'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {issue.category === 'overflow-x'
                          ? 'OVERFLOW-X'
                          : issue.category === 'touch-target'
                          ? 'TOUCH < 40PX'
                          : 'SAFE AREA'}
                      </span>
                      <h3 className="text-xs font-bold">{issue.title}</h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => onEnqueueIssue(issue)}
                      className="px-2.5 py-1 rounded-lg bg-[#B833FF] hover:bg-[#a224e6] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>В очередь агента</span>
                    </button>
                  </div>

                  <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {issue.description}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 pt-1">
                    <span>Путь: {issue.selector}</span>
                    {issue.sourceFile && (
                      <span className="text-emerald-400">
                        {issue.sourceFile}
                        {issue.sourceLine ? `:${issue.sourceLine}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-[#D8B4FE] font-medium">
                    Рекомендация для Antigravity: {issue.suggestedFix}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: TELEGRAM MINI APP SDK SIMULATOR & HAPTIC LOG */}
      <div className="lg:col-span-5 space-y-4">
        <div
          className={`p-5 rounded-2xl border space-y-4 ${
            isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          <div className="pb-3 border-b border-slate-200 dark:border-white/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#B833FF]" />
              <span>Симулятор окружения Telegram WebApp API</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Управляйте параметрами клиента Telegram внутри всех открытых iframe в реальном времени
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Цветовая схема Telegram (colorScheme):</span>
              <div className="flex items-center gap-1">
                {(['dark', 'light'] as const).map((scheme) => (
                  <button
                    key={scheme}
                    type="button"
                    onClick={() => onUpdateTgEnv({ colorScheme: scheme })}
                    className={`px-3 py-1 rounded-lg font-mono text-xs font-semibold cursor-pointer ${
                      tgEnv.colorScheme === scheme
                        ? 'bg-[#B833FF] text-white'
                        : isDark
                        ? 'bg-white/5 text-slate-400'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {scheme}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold">Внутренние отступы Safe Area в Mini App:</span>
              <button
                type="button"
                onClick={() => onUpdateTgEnv({ safeAreaPad: !tgEnv.safeAreaPad })}
                className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${
                  tgEnv.safeAreaPad
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {tgEnv.safeAreaPad ? 'Включены (pt-safe)' : 'Отключены (Коллизия)'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold">Нативная кнопка Telegram MainButton:</span>
              <button
                type="button"
                onClick={() => onUpdateTgEnv({ mainButtonVisible: !tgEnv.mainButtonVisible })}
                className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${
                  tgEnv.mainButtonVisible
                    ? 'bg-[#B833FF] text-white'
                    : isDark
                    ? 'bg-white/5 text-slate-400'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tgEnv.mainButtonVisible ? 'Активна внизу экрана' : 'Скрыта'}
              </button>
            </div>
          </div>
        </div>

        {/* HAPTIC TELEMETRY STREAM */}
        <div
          className={`p-5 rounded-2xl border space-y-3 ${
            isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[#B833FF]" />
              <span>Журнал тактильных импульсов Web Haptics ({hapticLogs.length})</span>
            </h3>
            {hapticLogs.length > 0 && (
              <button
                type="button"
                onClick={onClearHapticLogs}
                className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
              >
                Очистить лог
              </button>
            )}
          </div>

          {hapticLogs.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              Нажмите на любую кнопку или вкладку внутри экрана смартфона, чтобы увидеть параметры Haptic-импульса
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto font-mono text-[11px]">
              {hapticLogs.map((log) => (
                <div
                  key={log.id}
                  className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                    isDark ? 'bg-[#161625] border-white/5' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-bold text-[#B833FF]">{log.style}</span>
                    <span className="text-slate-400 ml-2">· {log.source}</span>
                  </div>
                  <div className="tabular-nums text-slate-400">
                    {log.frequencyHz}Hz / {log.durationMs}ms · {log.timestamp}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
