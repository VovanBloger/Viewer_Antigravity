'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  FileCode,
  Terminal,
  ChevronDown,
  ChevronRight,
  Code2,
} from 'lucide-react';

interface ModuleFileEntry {
  id: string;
  filename: string;
  title: string;
  role: string;
  linesSavedOrImpact: string;
  code: string;
}

const MODULES_CATALOG: ModuleFileEntry[] = [
  {
    id: 'haptics-singleton',
    filename: 'lib/haptics.ts',
    title: 'Синглтон Web Audio Haptics & Телеметрия',
    role: 'Устраняет утечку памяти AudioContext (лимит 6–32 контекстов в браузере) и добавляет профили огибающих частот.',
    linesSavedOrImpact: '0 утечек AudioContext · < 0.2ms задержка импульса',
    code: `// lib/haptics.ts — Готовый модуль для переноса в VovanBloger/Viewer_Antigravity
export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'selection' | 'success' | 'warning' | 'error';

class HapticAudioEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(style: ImpactStyle) {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freq = style === 'selection' ? 1250 : style === 'medium' ? 640 : style === 'heavy' ? 420 : 880;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
    osc.start();
    osc.stop(ctx.currentTime + 0.025);
  }
}

export const hapticAudioEngine = new HapticAudioEngine();`,
  },
  {
    id: 'raf-inspector',
    filename: 'lib/dom-inspector.ts',
    title: 'rAF-Инспектор Z-Index слоёв и Box Model HUD',
    role: 'Оборачивает вызовы elementsFromPoint и getBoundingClientRect в requestAnimationFrame, предотвращая Layout Thrashing.',
    linesSavedOrImpact: 'Стабильные 60 FPS при 3 открытых экранах',
    code: `// Фрагмент rAF-троттлинга инспектора для внедрения в useEffect(isInspectMode)
let rafId: number | null = null;
let lastTarget: HTMLElement | null = null;

const handleMouseMove = (e: MouseEvent) => {
  if (!isInspectMode || !doc) return;
  if (rafId !== null) return;

  const clientX = e.clientX;
  const clientY = e.clientY;
  const rawTarget = e.target as HTMLElement;

  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    if (!rawTarget || rawTarget.id?.startsWith('__antigravity')) return;
    const rect = rawTarget.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.transform = \`translate3d(\${rect.left}px, \${rect.top}px, 0)\`;
    overlay.style.width = \`\${rect.width}px\`;
    overlay.style.height = \`\${rect.height}px\`;
    lastTarget = rawTarget;
  });
};`,
  },
  {
    id: 'prompt-queue-diff',
    filename: 'lib/antigravity-core.ts',
    title: 'Генератор диффов (Было → Стало) и Пакетная очередь',
    role: 'Вычисляет дельту изменений между исходным состоянием DOM и настройками, формируя утилиты Tailwind.',
    linesSavedOrImpact: 'Пакетная отправка N элементов за 1 действие',
    code: `// Вычисление диффа стилей и формирование сводного промпта для Antigravity IDE
export function computeStyleDiff(initial: StyleTunerState, current: StyleTunerState) {
  const diffs = [];
  if (initial.bgOpacity !== current.bgOpacity) {
    diffs.push({
      property: 'Прозрачность фона',
      before: \`\${initial.bgOpacity}%\`,
      after: \`\${current.bgOpacity}%\`,
      tailwindSuggestion: current.bgOpacity === 0 ? 'bg-transparent' : \`bg-opacity-[\${(current.bgOpacity / 100).toFixed(2)}]\`,
    });
  }
  if (initial.radiusVal !== current.radiusVal) {
    diffs.push({
      property: 'Скругление углов',
      before: \`\${initial.radiusVal}px\`,
      after: \`\${current.radiusVal}px\`,
      tailwindSuggestion: \`rounded-[\${current.radiusVal}px]\`,
    });
  }
  return diffs;
}`,
  },
  {
    id: 'workspace-bridge-api',
    filename: 'app/api/antigravity-bridge/route.ts',
    title: 'Серверный мост синхронизации с рабочей областью',
    role: 'Определяет локальный IPv4 адрес Wi-Fi сети и записывает пакет визуальных правок в ANTIGRAVITY_TASKS.md.',
    linesSavedOrImpact: 'Авто-определение LAN IP · Прямая запись очереди',
    code: `// app/api/antigravity-bridge/route.ts
import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function POST(req: NextRequest) {
  const { queue = [], markdownPrompt = '' } = await req.json();
  await fs.writeFile(path.join(process.cwd(), 'ANTIGRAVITY_TASKS.md'), markdownPrompt, 'utf-8');
  await fs.writeFile(
    path.join(process.cwd(), '.antigravity-viewer-context.json'),
    JSON.stringify({ syncedAt: new Date().toISOString(), queue }, null, 2),
    'utf-8'
  );
  return NextResponse.json({ ok: true, syncedCount: queue.length });
}`,
  },
  {
    id: 'visual-layer-builder',
    filename: 'lib/dom-layer-engine.ts',
    title: 'Визуальный конструктор слоёв',
    role: 'Декомпозирует экран на дерево слоёв, позволяя группировать и менять узлы местами в живом DOM.',
    linesSavedOrImpact: 'Манипулирование макетом в реальном времени с Tailwind',
    code: `// Группировка и перестановка слоёв в живом DOM
export function groupDomLayers(doc: Document, layerIds: string[], groupName = 'Group_1') {
  const elements = layerIds
    .map((id) => doc.querySelector(\`[data-ag-layer-id="\${id}"]\`) as HTMLElement)
    .filter(Boolean);
  if (elements.length < 2 || !elements[0].parentElement) return null;

  const wrapper = doc.createElement('div');
  wrapper.setAttribute('data-ag-group', 'true');
  wrapper.setAttribute('data-component', groupName);
  wrapper.style.border = '1.5px dashed rgba(184, 51, 255, 0.65)';
  wrapper.style.borderRadius = '20px';
  wrapper.style.padding = '8px';

  elements[0].parentElement.insertBefore(wrapper, elements[0]);
  elements.forEach((el) => wrapper.appendChild(el));
  return wrapper;
}`,
  },
];

export function CodeBlueprintView({ isDark }: { isDark: boolean }) {
  const [selectedModuleId, setSelectedModuleId] = useState<string>(MODULES_CATALOG[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState(true);

  const activeModule = MODULES_CATALOG.find((m) => m.id === selectedModuleId) || MODULES_CATALOG[0];

  const handleCopyCode = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const borderMuted = isDark ? 'border-[#26262B]' : 'border-zinc-200';
  const cardBg = isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50';

  return (
    <div className="divide-y divide-[#26262B]">
      {/* TOP ACTIONS / MODULE SELECTOR (MATCHING SCREEN 5 INSPECTOR HEADER) */}
      <div className="pb-2.5 space-y-2">
        {/* Full-width primary copy button */}
        <button
          type="button"
          onClick={() => handleCopyCode(activeModule.id, activeModule.code)}
          title="Скопировать исходный код выбранного модуля"
          className={`w-full h-7 px-2.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            copiedId === activeModule.id
              ? 'bg-emerald-500 text-white font-semibold shadow-xs'
              : isDark
              ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs hover:bg-white'
              : 'bg-zinc-900 text-white font-semibold shadow-xs hover:bg-zinc-800'
          }`}
        >
          {copiedId === activeModule.id ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Код скопирован в буфер!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Копировать код модуля ({activeModule.filename.split('/').pop()})</span>
            </>
          )}
        </button>

        {/* Quick Module Chips (matching Screen 5 quick chips) */}
        <div className="grid grid-cols-3 gap-1">
          {[
            { id: 'haptics-singleton', label: 'haptics.ts' },
            { id: 'raf-inspector', label: 'inspector.ts' },
            { id: 'prompt-queue-diff', label: 'core.ts' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedModuleId(item.id)}
              className={`h-6 rounded border text-[10px] font-mono cursor-pointer transition-colors truncate px-1 ${
                selectedModuleId === item.id
                  ? isDark
                    ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                    : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                  : isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                  : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Dropdown for all modules */}
        <select
          aria-label="Выбрать модуль кода"
          value={selectedModuleId}
          onChange={(e) => setSelectedModuleId(e.target.value)}
          className={`w-full h-6 px-2 rounded border text-[10px] font-mono cursor-pointer ${
            isDark ? 'bg-[#18181C] border-[#27272A] text-zinc-300' : 'bg-white border-zinc-200 text-zinc-800'
          }`}
        >
          {MODULES_CATALOG.map((mod) => (
            <option key={mod.id} value={mod.id}>
              {mod.filename} — {mod.title}
            </option>
          ))}
        </select>

        {/* Selected Module Card (styled like Selected Element Card in Screen 5) */}
        <div className={`p-2 rounded-lg border space-y-1.5 ${borderMuted} ${cardBg}`}>
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-xs font-semibold text-purple-400">
                {activeModule.filename}
              </span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 shrink-0">
              TypeScript
            </span>
          </div>

          <div className="text-xs font-semibold text-zinc-200 leading-snug">
            {activeModule.title}
          </div>

          <div className="text-[10px] font-mono text-purple-300">
            {activeModule.linesSavedOrImpact}
          </div>

          <p className={`text-[11px] leading-snug ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {activeModule.role}
          </p>
        </div>
      </div>

      {/* SECTION 1: CODE BLOCK (ACCORDION) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => setOpenCode((v) => !v)}
            title="Свернуть или развернуть блок кода"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openCode ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <Code2 className="w-3.5 h-3.5 text-purple-400" />
            <span>Исходный код</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {activeModule.code.split('\n').length} строк
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleCopyCode(activeModule.id, activeModule.code)}
            title="Копировать код"
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

        {openCode && (
          <div className="space-y-1.5">
            <pre
              className={`p-3 rounded-lg border font-mono text-[11px] leading-relaxed max-h-[460px] overflow-auto select-text scrollbar-thin ${borderMuted} ${
                isDark ? 'bg-[#0E0E11] text-zinc-300' : 'bg-zinc-900 text-zinc-100'
              }`}
            >
              <code>{activeModule.code}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
