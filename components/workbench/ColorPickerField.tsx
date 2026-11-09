'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Pipette, ChevronDown } from 'lucide-react';
import { normalizeHexColor, hexToHsv, hsvToHex } from '@/lib/layer-builder';

const PAGE_COLORS = ['#FFFFFF', '#A855F7', '#F43F5E', '#38BDF8', '#3B1D7A', '#181625'];

interface ColorPickerFieldProps {
  id: string;
  label?: string;
  value: string;
  isDark: boolean;
  isCanvasEyedropperActive?: boolean;
  onChange: (hexColor: string) => void;
  onToggleCanvasEyedropper?: () => void;
}

export function ColorPickerField({
  id,
  label,
  value,
  isDark,
  isCanvasEyedropperActive = false,
  onChange,
  onToggleCanvasEyedropper,
}: ColorPickerFieldProps) {
  const resolvedHex = normalizeHexColor(value, '#FFFFFF');
  const [draftInput, setDraftInput] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [customHue, setCustomHue] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svSquareRef = useRef<HTMLDivElement>(null);
  const hueBarRef = useRef<HTMLDivElement>(null);

  const parsedHsv = hexToHsv(resolvedHex);
  const activeHue =
    customHue !== null && (parsedHsv.s === 0 || parsedHsv.v === 0)
      ? customHue
      : parsedHsv.h;
  const pureHueHex = hsvToHex(activeHue, 100, 100);
  const displayedInput = draftInput !== null ? draftInput : resolvedHex;

  useEffect(() => {
    if (!popoverOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [popoverOpen]);

  const commitColorInput = (raw: string) => {
    const normalized = normalizeHexColor(raw, resolvedHex);
    setDraftInput(null);
    onChange(normalized);
  };

  const updateSvFromPointer = (clientX: number, clientY: number) => {
    const box = svSquareRef.current?.getBoundingClientRect();
    if (!box) return;
    const s = Math.max(0, Math.min(100, Math.round(((clientX - box.left) / box.width) * 100)));
    const v = Math.max(
      0,
      Math.min(100, Math.round((1 - (clientY - box.top) / box.height) * 100))
    );
    const nextHex = hsvToHex(activeHue, s, v);
    setDraftInput(null);
    onChange(nextHex);
  };

  const updateHueFromPointer = (clientX: number) => {
    const box = hueBarRef.current?.getBoundingClientRect();
    if (!box) return;
    const h = Math.max(0, Math.min(360, Math.round(((clientX - box.left) / box.width) * 360)));
    setCustomHue(h);
    const nextS = parsedHsv.s === 0 ? 85 : parsedHsv.s;
    const nextV = parsedHsv.v === 0 ? 100 : parsedHsv.v;
    const nextHex = hsvToHex(h, nextS, nextV);
    setDraftInput(null);
    onChange(nextHex);
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      {label && (
        <span className="text-[10px] text-zinc-400 shrink-0 select-none">{label}</span>
      )}

      {/* SINGLE COLOR CIRCLE BUTTON (OPENS STANDARD 2D PALETTE POPOVER) */}
      <button
        type="button"
        data-testid={`color-circle-btn-${id}`}
        onClick={() => setPopoverOpen((prev) => !prev)}
        title="Открыть цветовую палитру и пипетку"
        aria-label={`Выбрать цвет (${resolvedHex})`}
        style={{ backgroundColor: resolvedHex }}
        className={`w-6 h-6 rounded-full border-2 shrink-0 cursor-pointer transition-transform hover:scale-105 ${
          popoverOpen || isCanvasEyedropperActive
            ? 'ring-2 ring-white border-zinc-950'
            : isDark
            ? 'border-zinc-500 hover:border-zinc-200'
            : 'border-zinc-400 hover:border-zinc-700'
        }`}
      />

      {/* COMPACT HEX VALUE INPUT */}
      <input
        type="text"
        data-testid={`color-hex-input-${id}`}
        aria-label={`HEX-код цвета (${id})`}
        title="Введите HEX-код цвета (например #FFB1B1)"
        value={displayedInput}
        onChange={(e) => {
          const v = e.target.value;
          setDraftInput(v);
          const clean = v.trim().replace(/^#+/, '');
          if (/^[0-9a-fA-F]{6}$/.test(clean)) {
            onChange('#' + clean.toUpperCase());
          }
        }}
        onBlur={() => commitColorInput(displayedInput)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitColorInput(displayedInput);
          }
        }}
        placeholder="#FFFFFF"
        className={`w-24 h-7 px-2 rounded-md border font-mono text-xs uppercase focus:outline-none ${
          isDark
            ? 'bg-[#0E0E11] border-[#27272A] text-zinc-100 focus:border-zinc-400'
            : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-600'
        }`}
      />

      {/* QUICK EYEDROPPER BUTTON ON MOCKUP */}
      {onToggleCanvasEyedropper && (
        <button
          type="button"
          data-testid={`color-eyedropper-btn-${id}`}
          onClick={() => {
            onToggleCanvasEyedropper();
            setPopoverOpen(false);
          }}
          title={
            isCanvasEyedropperActive
              ? 'Пипетка активна: наведите и кликните на любой элемент макета'
              : 'Пипетка: выбрать цвет любого элемента на макете телефона'
          }
          aria-label="Пипетка с макета"
          className={`h-7 w-7 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
            isCanvasEyedropperActive
              ? isDark
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100 shadow-xs'
                : 'bg-zinc-900 text-white border-zinc-900 shadow-xs'
              : isDark
              ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
              : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
          }`}
        >
          <Pipette className="w-3.5 h-3.5" />
        </button>
      )}

      {/* STANDARD 2D HSV COLOR PALETTE POPOVER (MATCHING SCREENSHOT) */}
      {popoverOpen && (
        <div
          data-testid={`color-palette-popover-${id}`}
          className={`absolute left-0 bottom-9 z-50 w-56 rounded-xl border shadow-2xl overflow-hidden select-none ${
            isDark
              ? 'bg-[#16161A] border-[#2E2E36] text-zinc-100'
              : 'bg-white border-zinc-200 text-zinc-900'
          }`}
        >
          {/* Header: Сплошной цвет v */}
          <div className="px-3 py-2 flex items-center gap-1 text-[11px] font-medium opacity-80">
            <span>Сплошной цвет</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </div>

          {/* 2D Saturation / Brightness Gradient Square */}
          <div
            ref={svSquareRef}
            data-testid={`color-sv-square-${id}`}
            onMouseDown={(e) => {
              e.preventDefault();
              updateSvFromPointer(e.clientX, e.clientY);
              const onMove = (me: MouseEvent) => updateSvFromPointer(me.clientX, me.clientY);
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            style={{ backgroundColor: pureHueHex }}
            className="relative w-full h-36 cursor-crosshair overflow-hidden"
          >
            {/* White-to-transparent horizontal saturation layer */}
            <div
              style={{
                background: 'linear-gradient(to right, #FFFFFF 0%, rgba(255,255,255,0) 100%)',
              }}
              className="absolute inset-0"
            />
            {/* Black-to-transparent vertical value/brightness layer */}
            <div
              style={{
                background: 'linear-gradient(to top, #000000 0%, rgba(0,0,0,0) 100%)',
              }}
              className="absolute inset-0"
            />

            {/* Draggable Thumb Circle */}
            <div
              style={{
                left: `${parsedHsv.s}%`,
                top: `${100 - parsedHsv.v}%`,
                backgroundColor: resolvedHex,
              }}
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.6)] pointer-events-none"
            />
          </div>

          {/* Controls Body */}
          <div className="p-3 space-y-3">
            {/* Rainbow Hue Slider Bar */}
            <div
              ref={hueBarRef}
              data-testid={`color-hue-slider-${id}`}
              onMouseDown={(e) => {
                e.preventDefault();
                updateHueFromPointer(e.clientX);
                const onMove = (me: MouseEvent) => updateHueFromPointer(me.clientX);
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              style={{
                background:
                  'linear-gradient(to right, #FF0000 0%, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000 100%)',
              }}
              className="relative w-full h-3 rounded-full cursor-pointer"
            >
              <div
                style={{
                  left: `${(activeHue / 360) * 100}%`,
                  backgroundColor: pureHueHex,
                }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.55)] pointer-events-none"
              />
            </div>

            {/* HEX Input + Eyedropper Button Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-0.5 text-[11px] font-medium opacity-75 shrink-0">
                <span>HEX</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </div>

              <input
                type="text"
                value={displayedInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraftInput(v);
                  const clean = v.trim().replace(/^#+/, '');
                  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
                    onChange('#' + clean.toUpperCase());
                  }
                }}
                onBlur={() => commitColorInput(displayedInput)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitColorInput(displayedInput);
                }}
                className={`flex-1 min-w-0 h-7 px-2 rounded border font-mono text-xs uppercase focus:outline-none ${
                  isDark
                    ? 'bg-[#0E0E11] border-[#27272A] text-zinc-100'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-900'
                }`}
              />

              {onToggleCanvasEyedropper && (
                <button
                  type="button"
                  data-testid={`popover-eyedropper-btn-${id}`}
                  onClick={() => {
                    onToggleCanvasEyedropper();
                    setPopoverOpen(false);
                  }}
                  title="Пипетка: наведите на макет телефона и кликните для выбора цвета"
                  aria-label="Включить пипетку на макете"
                  className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    isCanvasEyedropperActive
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : isDark
                      ? 'bg-[#1F1F24] border-[#2E2E36] text-zinc-300 hover:text-white'
                      : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:text-zinc-950'
                  }`}
                >
                  <Pipette className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Bottom Section: Цвета на странице */}
            <div className={`pt-2.5 border-t space-y-2 ${isDark ? 'border-[#26262B]' : 'border-zinc-200'}`}>
              <div className="flex items-center gap-1 text-[11px] font-medium opacity-75">
                <span>Цвета на странице</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </div>

              <div className="flex items-center gap-2">
                {PAGE_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    title={`Выбрать цвет ${swatch}`}
                    aria-label={`Цвет страницы ${swatch}`}
                    onClick={() => {
                      setDraftInput(null);
                      onChange(swatch);
                    }}
                    style={{ backgroundColor: swatch }}
                    className={`w-5 h-5 rounded-full border cursor-pointer transition-transform hover:scale-110 ${
                      resolvedHex.toUpperCase() === swatch.toUpperCase()
                        ? 'ring-2 ring-white border-zinc-950'
                        : isDark
                        ? 'border-white/20'
                        : 'border-black/20'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
