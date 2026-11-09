'use client';

import React, { useState } from 'react';
import { Palette, Keyboard, LayoutGrid, Check, RotateCcw } from 'lucide-react';
import {
  ANTIGRAVITY_THEMES,
  AntigravityTheme,
  HotkeyBinding,
  WORKSPACE_PRESETS,
} from '@/lib/preview-devices';

interface HotkeysThemeViewProps {
  activeThemeKey: AntigravityTheme['key'];
  onSelectTheme: (key: AntigravityTheme['key']) => void;
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (id: string, newCombo: string) => void;
  onResetHotkeys: () => void;
  onApplyPreset: (presetId: string) => void;
  isDark: boolean;
}

export function HotkeysThemeView({
  activeThemeKey,
  onSelectTheme,
  hotkeys,
  onUpdateHotkey,
  onResetHotkeys,
  onApplyPreset,
  isDark,
}: HotkeysThemeViewProps) {
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const handleKeyDownRecord = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

    onUpdateHotkey(id, parts.join('+'));
    setRecordingId(null);
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: ANTIGRAVITY NATIVE THEMES */}
      <div
        className={`p-5 rounded-2xl border ${
          isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
        }`}
      >
        <div className="pb-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Palette className="w-4 h-4 text-[#B833FF]" />
            <span>Темы рабочей станции Antigravity IDE</span>
          </h2>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Выберите цветовую палитру окружения для комфортной инспекции светлых и тёмных интерфейсов
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          {Object.values(ANTIGRAVITY_THEMES).map((theme) => {
            const isSelected = theme.key === activeThemeKey;
            return (
              <button
                key={theme.key}
                type="button"
                onClick={() => onSelectTheme(theme.key)}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isSelected
                    ? 'border-[#B833FF] ring-2 ring-[#B833FF]/30'
                    : isDark
                    ? 'bg-[#161625] border-white/10 hover:border-white/25'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{theme.name}</span>
                    {isSelected && <Check className="w-4 h-4 text-[#B833FF]" />}
                  </div>
                  <p className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {theme.subtitle}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <span
                    className={`w-6 h-6 rounded-lg border border-white/20 ${theme.canvasBg}`}
                    title="Фон холста"
                  />
                  <span
                    className={`w-6 h-6 rounded-lg border border-white/20 ${theme.surfaceBg}`}
                    title="Поверхность панели"
                  />
                  <span
                    style={{ backgroundColor: theme.accentHex }}
                    className="w-6 h-6 rounded-lg border border-white/20"
                    title="Акцентный импульс"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: CUSTOM HOTKEYS MANAGER */}
      <div
        className={`p-5 rounded-2xl border ${
          isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-[#B833FF]" />
              <span>Персонализация горячих клавиш</span>
            </h2>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Нажмите на любую комбинацию клавиш, чтобы записать собственное сочетание
            </p>
          </div>

          <button
            type="button"
            onClick={onResetHotkeys}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              isDark ? 'bg-[#181828] border-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сбросить по умолчанию</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {hotkeys.map((hk) => {
            const isRecording = recordingId === hk.id;
            return (
              <div
                key={hk.id}
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                  isDark ? 'bg-[#161625] border-white/10' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold">{hk.actionName}</div>
                  <div className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {hk.description}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setRecordingId(isRecording ? null : hk.id)}
                  onKeyDown={(e) => {
                    if (isRecording) handleKeyDownRecord(e, hk.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold border shrink-0 cursor-pointer transition-all ${
                    isRecording
                      ? 'bg-[#B833FF] text-white border-[#B833FF] animate-pulse'
                      : isDark
                      ? 'bg-black/40 border-white/15 text-[#D8B4FE] hover:border-[#B833FF]'
                      : 'bg-white border-slate-300 text-purple-700 hover:border-purple-500'
                  }`}
                >
                  {isRecording ? 'Нажмите клавиши...' : hk.combo}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 3: WORKSPACE MULTI-DEVICE PRESETS */}
      <div
        className={`p-5 rounded-2xl border ${
          isDark ? 'bg-[#11111C] border-white/10' : 'bg-white border-slate-200'
        }`}
      >
        <div className="pb-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-[#B833FF]" />
            <span>Быстрые сценарии мультиэкранного холста</span>
          </h2>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Переключайте конфигурацию открытых смартфонов и планшетов одним кликом
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {WORKSPACE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.id)}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer space-y-1.5 ${
                isDark
                  ? 'bg-[#161625] border-white/10 hover:border-[#B833FF]'
                  : 'bg-slate-50 border-slate-200 hover:border-purple-500'
              }`}
            >
              <div className="text-xs font-bold text-[#B833FF]">{preset.name}</div>
              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {preset.description}
              </p>
              <div className="text-[10px] font-mono text-slate-400 pt-1">
                Экранов: {preset.slots.length} · Масштаб: {Math.round(preset.recommendedZoom * 100)}%
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
