'use client';

import React, { useState } from 'react';
import {
  Keyboard,
  LayoutGrid,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  HotkeyBinding,
  WORKSPACE_PRESETS,
} from '@/lib/preview-devices';

interface HotkeysThemeViewProps {
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (id: string, newCombo: string) => void;
  onResetHotkeys: () => void;
  onApplyPreset: (presetId: string) => void;
  isDark: boolean;
}

export function HotkeysThemeView({
  hotkeys,
  onUpdateHotkey,
  onResetHotkeys,
  onApplyPreset,
  isDark,
}: HotkeysThemeViewProps) {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [openHotkeys, setOpenHotkeys] = useState(true);
  const [openPresets, setOpenPresets] = useState(true);

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

  const borderMuted = isDark ? 'border-[#26262B]' : 'border-zinc-200';
  const cardBg = isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50';

  return (
    <div className="divide-y divide-[#26262B]">
      {/* TOP HEADER / ACTIONS (MATCHING SCREEN 5 INSPECTOR HEADER) */}
      <div className="pb-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Keyboard className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="text-xs font-semibold text-zinc-200 truncate">
              Настройки горячих клавиш
            </span>
          </div>

          <button
            type="button"
            onClick={onResetHotkeys}
            title="Восстановить стандартные комбинации клавиш"
            className={`h-6 px-2 rounded border text-[10px] font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors ${
              isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:text-white hover:bg-zinc-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Сбросить</span>
          </button>
        </div>

        <p className={`text-[11px] leading-snug ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          Нажмите на кнопку с комбинацией клавиш, чтобы записать собственное сочетание для быстрой работы.
        </p>
      </div>

      {/* SECTION 1: CUSTOM HOTKEYS LIST (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenHotkeys((v) => !v)}
            title="Свернуть или развернуть список горячих клавиш"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openHotkeys ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>Сочетания клавиш</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {hotkeys.length}
            </span>
          </button>
        </div>

        {openHotkeys && (
          <div className="space-y-1.5">
            {hotkeys.map((hk) => {
              const isRecording = recordingId === hk.id;
              return (
                <div
                  key={hk.id}
                  className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${borderMuted} ${cardBg} hover:border-zinc-700`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-200 truncate">
                      {hk.actionName}
                    </div>
                    <div className={`text-[10px] truncate ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>
                      {hk.description}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setRecordingId(isRecording ? null : hk.id)}
                    onKeyDown={(e) => {
                      if (isRecording) handleKeyDownRecord(e, hk.id);
                    }}
                    title={isRecording ? 'Нажмите нужную комбинацию на клавиатуре' : 'Кликните, чтобы изменить'}
                    className={`h-6 px-2 font-mono text-[10px] font-semibold rounded border shrink-0 cursor-pointer transition-all ${
                      isRecording
                        ? 'bg-purple-600 text-white border-purple-500 animate-pulse'
                        : isDark
                        ? 'bg-[#18181C] border-[#27272A] text-purple-300 hover:border-purple-400 hover:text-white'
                        : 'bg-white border-zinc-300 text-purple-700 hover:border-purple-500'
                    }`}
                  >
                    {isRecording ? 'Запись...' : hk.combo}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: WORKSPACE MULTI-DEVICE PRESETS (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenPresets((v) => !v)}
            title="Свернуть или развернуть пресеты холста"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openPresets ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <LayoutGrid className="w-3.5 h-3.5 text-purple-400" />
            <span>Сценарии экранов</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {WORKSPACE_PRESETS.length}
            </span>
          </button>
        </div>

        {openPresets && (
          <div className="space-y-1.5">
            {WORKSPACE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset.id)}
                title={`Применить сценарий: ${preset.name}`}
                className={`w-full text-left p-2 rounded-lg border transition-all cursor-pointer space-y-1 ${borderMuted} ${cardBg} hover:border-purple-500/50`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-400">
                    {preset.name}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {preset.slots.length} экрана
                  </span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 truncate">
                  {preset.slots.map((s) => s.deviceKey).join(' · ')}
                </div>
                <p className={`text-[10px] leading-snug line-clamp-2 ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>
                  {preset.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
