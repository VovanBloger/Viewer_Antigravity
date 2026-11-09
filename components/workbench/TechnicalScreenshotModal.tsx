'use client';

import React, { useState } from 'react';
import { X, Download, Copy, Check, Plus, Camera, Layers, Eye } from 'lucide-react';
import { VisualTechnicalScreenshotResult } from '@/lib/screenshot-engine';

interface TechnicalScreenshotModalProps {
  screenshot: VisualTechnicalScreenshotResult | null;
  isDark: boolean;
  onClose: () => void;
  onEnqueueScreenshot: (shot: VisualTechnicalScreenshotResult) => void;
}

export function TechnicalScreenshotModal({
  screenshot,
  isDark,
  onClose,
  onEnqueueScreenshot,
}: TechnicalScreenshotModalProps) {
  const [copiedReport, setCopiedReport] = useState(false);
  const [enqueued, setEnqueued] = useState(false);
  const [gridOpacity, setGridOpacity] = useState(65);
  const [hoveredObjIndex, setHoveredObjIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'interactive' | 'composite'>('interactive');

  if (!screenshot) return null;

  const handleDownloadPng = () => {
    if (!screenshot.dataUrl) return;
    const link = document.createElement('a');
    link.href = screenshot.dataUrl;
    link.download = `antigravity-tech-shot-${screenshot.mode}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(screenshot.markdownReport);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  return (
    <div
      data-testid="technical-screenshot-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        className={`w-full max-w-5xl max-h-[92vh] rounded-xl border shadow-2xl flex flex-col overflow-hidden ${
          isDark
            ? 'bg-[#141417] border-[#26262B] text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        {/* Header */}
        <div
          className={`h-11 px-4 border-b flex items-center justify-between shrink-0 ${
            isDark ? 'border-[#26262B] bg-[#0E0E11]' : 'border-zinc-200 bg-zinc-50'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Camera className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="text-xs font-semibold truncate">
              Визуально-технический скриншот (
              {screenshot.mode === 'full' ? 'Весь экран' : 'Выделенный кусок'})
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              {screenshot.cropRect.width}×{screenshot.cropRect.height}px · Объектов:{' '}
              {screenshot.objects.length}
            </span>
          </div>

          {/* Grid Opacity & View Mode Controls */}
          <div className="flex items-center gap-3">
            <div
              title="Регулировка прозрачности сетки элементов поверх визуала"
              className="flex items-center gap-1.5 text-[11px] text-zinc-400"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Сетка:</span>
              <input
                type="range"
                aria-label="Прозрачность сетки элементов"
                min={0}
                max={100}
                step={5}
                value={gridOpacity}
                onChange={(e) => setGridOpacity(parseInt(e.target.value, 10))}
                className="w-16 accent-zinc-200 cursor-pointer"
              />
              <span className="font-mono text-[10px] w-7 text-right tabular-nums text-zinc-300">
                {gridOpacity}%
              </span>
            </div>

            <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-[#27272A] bg-[#18181C] text-[10px]">
              <button
                type="button"
                onClick={() => setViewMode('interactive')}
                title="Визуал с интерактивной полупрозрачной сеткой поверх"
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  viewMode === 'interactive'
                    ? 'bg-zinc-200 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                Визуал + Сетка
              </button>
              <button
                type="button"
                onClick={() => setViewMode('composite')}
                title="Полный технический PNG-лист со встроенной таблицей внизу"
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  viewMode === 'composite'
                    ? 'bg-zinc-200 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                Полный PNG
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Закрыть окно скриншота"
              aria-label="Закрыть окно скриншота"
              className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Left = Visual Snapshot + Semi-Transparent Element Grid Overlay, Right = Annotated Objects List */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#26262B] overflow-hidden">
          {/* Left: Visual + Semi-Transparent Grid Overlay */}
          <div className="p-4 overflow-y-auto flex flex-col items-center justify-start bg-[#0A0A0D]">
            {viewMode === 'interactive' && screenshot.visualOnlyDataUrl ? (
              <div
                style={{
                  width: `${screenshot.cropRect.width}px`,
                  height: `${screenshot.cropRect.height}px`,
                }}
                className="relative shrink-0 rounded-xl overflow-hidden border border-[#27272A] shadow-2xl select-none"
              >
                {/* 1. True Visual Screenshot Base */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshot.visualOnlyDataUrl}
                  alt="Визуальный снимок экрана"
                  data-testid="technical-screenshot-img"
                  className="w-full h-full object-cover block"
                />

                {/* 2. Semi-Transparent Element Grid Overlaid on Top */}
                <div
                  style={{ opacity: gridOpacity / 100 }}
                  className="absolute inset-0 pointer-events-none transition-opacity duration-75"
                >
                  {screenshot.objects.map((obj) => {
                    const relLeft = obj.rect.x - screenshot.cropRect.x;
                    const relTop = obj.rect.y - screenshot.cropRect.y;
                    const isHighlighted = hoveredObjIndex === obj.index;
                    const isTextOrIcon = Boolean(obj.textSnippet) || obj.tag === 'svg';
                    return (
                      <div
                        key={`overlay-${obj.layerId}-${obj.index}`}
                        style={{
                          left: `${relLeft}px`,
                          top: `${relTop}px`,
                          width: `${obj.rect.width}px`,
                          height: `${obj.rect.height}px`,
                        }}
                        className={`absolute box-border rounded-[4px] transition-all ${
                          isHighlighted
                            ? 'border-2 border-white bg-purple-500/20 z-20'
                            : 'border border-dashed border-purple-300/45 bg-purple-500/[0.03]'
                        }`}
                      >
                        <span
                          className={`absolute -top-0.5 ${
                            isTextOrIcon ? 'right-0' : 'left-0'
                          } px-1 py-0 rounded-[3px] font-mono text-[8px] font-bold leading-tight border ${
                            isHighlighted
                              ? 'bg-white text-zinc-950 border-white'
                              : 'bg-zinc-950/60 text-purple-100/90 border-purple-300/40'
                          }`}
                        >
                          #{obj.index}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : screenshot.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={screenshot.dataUrl}
                alt="Визуально-технический скриншот"
                data-testid="technical-screenshot-img"
                className="max-w-full h-auto rounded-lg border border-[#27272A] shadow-lg"
              />
            ) : (
              <div className="text-xs text-zinc-500 py-12">Снимок сформирован</div>
            )}
          </div>

          {/* Right: Structured Object List & Text Manifest */}
          <div className="p-4 overflow-y-auto space-y-3 flex flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Объекты, попавшие в кадр ({screenshot.objects.length})</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                X:{screenshot.cropRect.x} Y:{screenshot.cropRect.y}
              </span>
            </div>

            <div
              data-testid="screenshot-object-list"
              className={`max-h-60 overflow-y-auto rounded-lg border divide-y ${
                isDark
                  ? 'bg-[#0E0E11] border-[#27272A] divide-[#1F1F24]'
                  : 'bg-zinc-50 border-zinc-200 divide-zinc-200'
              }`}
            >
              {screenshot.objects.map((obj) => (
                <div
                  key={`${obj.layerId}-${obj.index}`}
                  onMouseEnter={() => setHoveredObjIndex(obj.index)}
                  onMouseLeave={() => setHoveredObjIndex(null)}
                  className={`px-2.5 py-1.5 flex items-start justify-between gap-2 text-xs transition-colors ${
                    hoveredObjIndex === obj.index ? 'bg-zinc-800/80' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px] font-semibold">
                        #{obj.index}
                      </span>
                      <span className="font-mono font-semibold text-[11px] truncate">
                        {obj.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">
                        &lt;{obj.tag}&gt;
                      </span>
                    </div>
                    {obj.textSnippet && (
                      <div className="text-[11px] text-zinc-300 truncate">
                        «{obj.textSnippet}»
                      </div>
                    )}
                    {obj.sourceFile && (
                      <div className="text-[10px] font-mono text-zinc-500 truncate">
                        {obj.sourceFile}
                        {obj.sourceLine ? `:${obj.sourceLine}` : ''}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                      {obj.rect.width}×{obj.rect.height}px
                    </span>
                    <div className="flex items-center gap-1">
                      <span
                        style={{ backgroundColor: obj.colorHex }}
                        className="w-3 h-3 rounded-full border border-white/25 inline-block"
                      />
                      <span className="font-mono text-[10px] text-zinc-500">
                        {obj.colorHex}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Text Specification Block */}
            <div className="space-y-1 flex-1 flex flex-col">
              <span className="text-[11px] font-medium text-zinc-400">
                Текстовое описание объектов скриншота:
              </span>
              <textarea
                readOnly
                data-testid="screenshot-markdown-report"
                value={screenshot.markdownReport}
                rows={5}
                className={`w-full flex-1 p-2.5 rounded-lg border font-mono text-[11px] focus:outline-none resize-none ${
                  isDark
                    ? 'bg-[#0E0E11] border-[#27272A] text-zinc-300'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-800'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className={`px-4 py-2.5 border-t flex items-center justify-between gap-2 shrink-0 ${
            isDark ? 'border-[#26262B] bg-[#0E0E11]' : 'border-zinc-200 bg-zinc-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPng}
              title="Скачать полный визуально-технический скриншот (визуал + сетка + список объектов) в формате PNG"
              className={`h-8 px-3 rounded-md border text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-zinc-300 text-zinc-800 hover:bg-zinc-100'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать PNG</span>
            </button>

            <button
              type="button"
              onClick={handleCopyReport}
              title="Скопировать текстовый список всех объектов в буфер обмена"
              className={`h-8 px-3 rounded-md border text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-zinc-300 text-zinc-800 hover:bg-zinc-100'
              }`}
            >
              {copiedReport ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedReport ? 'Скопировано' : 'Копировать список объектов'}</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="enqueue-screenshot-btn"
            onClick={() => {
              onEnqueueScreenshot(screenshot);
              setEnqueued(true);
              setTimeout(() => {
                setEnqueued(false);
                onClose();
              }, 600);
            }}
            title="Прикрепить скриншот и список попавших в него объектов в очередь задач агента"
            className={`h-8 px-3.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              isDark
                ? 'bg-zinc-100 hover:bg-white text-zinc-950'
                : 'bg-zinc-900 hover:bg-zinc-800 text-white'
            }`}
          >
            {enqueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>
              {enqueued ? 'Добавлено в очередь' : 'В очередь агента со списком объектов'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
