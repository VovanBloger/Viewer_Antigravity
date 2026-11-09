'use client';

import React, { useState } from 'react';
import { RotateCw, Camera, X, Shield, Crop, Maximize, Check } from 'lucide-react';
import { DeviceSpec } from '@/lib/preview-devices';
import { AgentQueueItem } from '@/lib/antigravity-core';

interface PhoneSlotProps {
  id: string;
  device: DeviceSpec;
  rotated: boolean;
  showBezel: boolean;
  showSafeArea: boolean;
  canRemove: boolean;
  hapticTriggered: boolean;
  allDevices: Record<string, DeviceSpec>;
  pins: AgentQueueItem[];
  iframeRef: (el: HTMLIFrameElement | null) => void;
  onRotate: () => void;
  onChangeDevice: (newKey: string) => void;
  onRemove: () => void;
  onCaptureScreenshot: (
    slotId: string,
    cropRect: { x: number; y: number; width: number; height: number },
    mode: 'full' | 'region'
  ) => void;
  onSelectPin?: (item: AgentQueueItem) => void;
  isDark: boolean;
  iframeSrc?: string;
  slotTitle?: string;
  canvasEyedropperActive?: boolean;
  hoveredEyedropperHex?: string | null;
  onCancelEyedropper?: () => void;
  onIframeLoad?: () => void;
}

export function PhoneSlot({
  id,
  device,
  rotated,
  showBezel,
  showSafeArea,
  canRemove,
  hapticTriggered,
  allDevices,
  pins,
  iframeRef,
  onRotate,
  onChangeDevice,
  onRemove,
  onCaptureScreenshot,
  onSelectPin,
  isDark,
  iframeSrc = '/demo',
  slotTitle = 'Viewer Mini App',
  onIframeLoad,
}: PhoneSlotProps) {
  const width = rotated ? device.h : device.w;
  const height = rotated ? device.w : device.h;

  const [shotMode, setShotMode] = useState<'idle' | 'menu' | 'region'>('idle');
  const [cropBox, setCropBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({
    x: 12,
    y: 330,
    width: Math.max(120, width - 24),
    height: 220,
  });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const handleOpenShotMenu = () => {
    if (shotMode !== 'idle') {
      setShotMode('idle');
      return;
    }
    setCropBox({
      x: 12,
      y: 330,
      width: Math.max(120, width - 24),
      height: 220,
    });
    setShotMode('menu');
  };

  return (
    <div
      data-testid={`phone-slot-${id}`}
      className="flex flex-col items-center gap-2.5 shrink-0 select-none"
    >
      {/* SLOT CONTROLS ROW */}
      <div
        className={`flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg border transition-colors w-full ${
          isDark
            ? 'bg-[#141417] border-[#26262B] text-zinc-200'
            : 'bg-white border-zinc-200 text-zinc-800 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <select
            aria-label={`Устройство для слота ${id}`}
            title={`Модель устройства (${rotated ? `${device.h}×${device.w}` : `${device.w}×${device.h}`}px · @${device.dpr}x)`}
            value={device.key}
            onChange={(e) => onChangeDevice(e.target.value)}
            className={`text-xs font-medium rounded-md px-2 py-1 border focus:outline-none cursor-pointer ${
              isDark
                ? 'bg-[#0E0E11] border-[#27272A] text-zinc-100'
                : 'bg-zinc-50 border-zinc-300 text-zinc-800'
            }`}
          >
            {Object.entries(allDevices).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name} · {rotated ? `${v.h}×${v.w}` : `${v.w}×${v.h}`}
              </option>
            ))}
          </select>
          <span
            title="Разрешение экрана в пикселях"
            className="text-[10px] font-mono tabular-nums text-zinc-500 hidden sm:inline whitespace-nowrap"
          >
            {rotated ? `${device.h}×${device.w}` : `${device.w}×${device.h}`}
          </span>
        </div>

        {/* Slot Action Buttons: Rotate, Screenshot, Close */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onRotate}
            aria-label={`Повернуть ${device.name} на 90 градусов`}
            title="Повернуть экран на 90°"
            className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs transition-colors cursor-pointer ${
              rotated
                ? isDark
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                  : 'bg-zinc-900 text-white border-zinc-900'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:text-zinc-950'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid={`slot-screenshot-btn-${id}`}
            onClick={handleOpenShotMenu}
            aria-label={`Сделать скриншот ${device.name}`}
            title="Сделать визуально-технический скриншот (весь экран или выделенный кусок)"
            className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs transition-colors cursor-pointer ${
              shotMode !== 'idle'
                ? isDark
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                  : 'bg-zinc-900 text-white border-zinc-900'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:text-zinc-950'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Закрыть слот ${device.name}`}
              title="Закрыть этот экран"
              className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs transition-colors cursor-pointer ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-rose-400'
                  : 'bg-zinc-100 border-zinc-300 text-zinc-600 hover:text-rose-600'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* INLINE SCREENSHOT CAPTURE BAR (FULL SCREEN vs SELECT REGION) */}
      {shotMode !== 'idle' && (
        <div
          data-testid="screenshot-mode-bar"
          className={`w-full px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-1.5 text-xs ${
            isDark
              ? 'bg-[#141417] border-[#2E2E36] text-zinc-100'
              : 'bg-white border-zinc-300 text-zinc-900 shadow-sm'
          }`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="capture-full-screen-btn"
              onClick={() => {
                onCaptureScreenshot(id, { x: 0, y: 0, width, height }, 'full');
                setShotMode('idle');
              }}
              title="Снять весь экран мокапа со списком всех элементов"
              className={`h-7 px-2.5 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100 hover:bg-white font-semibold'
                  : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
              }`}
            >
              <Maximize className="w-3 h-3" />
              <span>Весь экран</span>
            </button>

            <button
              type="button"
              data-testid="capture-region-btn"
              onClick={() => setShotMode('region')}
              title="Выделить кусок экрана рамкой и получить список попавших в него объектов"
              className={`h-7 px-2.5 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                shotMode === 'region'
                  ? isDark
                    ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                    : 'bg-zinc-800 text-white border-zinc-800 font-semibold'
                  : isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                  : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              <Crop className="w-3 h-3" />
              <span>Выделить кусок</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShotMode('idle')}
            title="Отменить режим снимка экрана"
            className="h-6 w-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* DEVICE FRAME CONTAINER */}
      <div
        style={{
          width: showBezel ? `${width + 28}px` : `${width}px`,
          height: showBezel ? `${height + 28}px` : `${height}px`,
          borderRadius: showBezel ? device.rad : '24px',
          padding: showBezel ? '14px' : '0px',
        }}
        className={`relative bg-[#0A0A0E] shadow-2xl border-4 overflow-hidden flex flex-col transition-all duration-150 ${
          showBezel ? 'border-[#2D2B45]' : 'border-slate-800'
        } ${
          hapticTriggered ? 'border-[#B833FF] shadow-[0_0_35px_rgba(184,51,255,0.55)]' : ''
        }`}
      >
        {/* SCREEN INNER */}
        <div
          style={{ borderRadius: showBezel ? '38px' : '20px' }}
          className="relative w-full h-full bg-[#111019] overflow-hidden"
        >
          {/* LIVE IFRAME */}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            title={`Предпросмотр ${device.name}`}
            className="absolute inset-0 w-full h-full border-none bg-transparent"
            allow="camera; microphone; clipboard-write; geolocation;"
            onLoad={onIframeLoad}
          />

          {/* INTERACTIVE REGION CROP OVERLAY FOR VISUAL-TECHNICAL SCREENSHOT */}
          {shotMode === 'region' && (
            <div
              data-testid="region-crop-overlay"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('[data-crop-action]')) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const scaleX = width / Math.max(1, rect.width);
                const scaleY = height / Math.max(1, rect.height);
                const startX = Math.round((e.clientX - rect.left) * scaleX);
                const startY = Math.round((e.clientY - rect.top) * scaleY);
                setDragStart({ x: startX, y: startY });
                setCropBox({ x: startX, y: startY, width: 60, height: 60 });
              }}
              onMouseMove={(e) => {
                if (!dragStart) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const scaleX = width / Math.max(1, rect.width);
                const scaleY = height / Math.max(1, rect.height);
                const currX = Math.max(0, Math.min(width, Math.round((e.clientX - rect.left) * scaleX)));
                const currY = Math.max(0, Math.min(height, Math.round((e.clientY - rect.top) * scaleY)));
                const x = Math.min(dragStart.x, currX);
                const y = Math.min(dragStart.y, currY);
                const w = Math.max(48, Math.abs(currX - dragStart.x));
                const h = Math.max(48, Math.abs(currY - dragStart.y));
                setCropBox({ x, y, width: w, height: h });
              }}
              onMouseUp={() => setDragStart(null)}
              className="absolute inset-0 z-50 bg-black/45 cursor-crosshair"
            >
              {/* Selection Box */}
              <div
                style={{
                  left: `${cropBox.x}px`,
                  top: `${cropBox.y}px`,
                  width: `${cropBox.width}px`,
                  height: `${cropBox.height}px`,
                }}
                className="absolute border-2 border-white bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] rounded-lg flex flex-col justify-between p-1.5"
              >
                <div className="flex items-center justify-between gap-1 pointer-events-none">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950/90 text-white font-mono text-[10px] border border-white/20">
                    {cropBox.width}×{cropBox.height}px ({cropBox.x},{cropBox.y})
                  </span>
                </div>

                <div
                  data-crop-action="true"
                  className="flex items-center justify-end gap-1 self-end"
                >
                  <button
                    type="button"
                    data-testid="confirm-region-capture-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCaptureScreenshot(id, cropBox, 'region');
                      setShotMode('idle');
                    }}
                    title="Снять выделенный кусок экрана и сформировать список попавших объектов"
                    className="h-7 px-2.5 rounded-md bg-white text-zinc-950 font-semibold text-[11px] shadow-lg flex items-center gap-1 cursor-pointer hover:bg-zinc-100"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Снять кусок</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SAFE AREA OVERLAY HUD */}
          {showSafeArea && (
            <>
              <div
                style={{ height: `${device.safeTop}px` }}
                className="absolute top-0 inset-x-0 z-45 bg-amber-500/15 border-b border-dashed border-amber-400/75 pointer-events-none flex items-end justify-center px-3 pb-0.5"
              >
                <span className="text-[9px] font-mono font-bold text-amber-300 bg-black/85 border border-amber-400/40 px-2 py-0.5 rounded shadow-sm">
                  Safe Top: {device.safeTop}px
                </span>
              </div>
              {device.safeBottom > 0 && (
                <div
                  style={{ height: `${device.safeBottom}px` }}
                  className="absolute bottom-0 inset-x-0 z-45 bg-amber-500/15 border-t border-dashed border-amber-400/75 pointer-events-none flex items-start justify-end px-3 pt-1"
                >
                  <span className="text-[9px] font-mono font-bold text-amber-300 bg-black/85 border border-amber-400/40 px-2 py-0.5 rounded shadow-sm">
                    Safe Bottom: {device.safeBottom}px
                  </span>
                </div>
              )}
            </>
          )}

          {/* SPATIAL PIN ANNOTATIONS OVERLAY */}
          {pins.map((pin, pinIdx) => {
            const top = Math.min(height - 32, Math.max(48, pin.element.rect.top - 10));
            const baseRightLeft = pin.element.rect.left + pin.element.rect.width - 26 - pinIdx * 28;
            const left = Math.min(width - 32, Math.max(12, baseRightLeft));
            return (
              <button
                key={pin.id}
                type="button"
                onClick={() => onSelectPin?.(pin)}
                style={{ top: `${top}px`, left: `${left}px` }}
                title={`Пин #${pin.pinNumber}: <${pin.element.tag}> — ${pin.note || 'В очереди правок'}`}
                className="absolute z-45 w-6 h-6 rounded-full bg-[#B833FF] text-white border-2 border-white font-mono text-[10px] font-extrabold shadow-lg flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
              >
                {pin.pinNumber}
              </button>
            );
          })}

          {/* TELEGRAM MINI APP HEADER OVERLAY */}
          <div className="absolute top-0 inset-x-0 z-40 pt-2 px-5 pb-2 bg-gradient-to-b from-black/65 via-black/25 to-transparent flex flex-col pointer-events-none select-none">
            <div className="flex items-center justify-between text-white text-[11px] font-semibold h-6">
              <span className="tracking-tight font-mono font-bold drop-shadow-sm tabular-nums">9:41</span>
              {device.dynamicIsland ? (
                <div className="w-24 h-5 bg-black rounded-full flex items-center justify-center gap-1.5 px-2 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-[#181824]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E0E14]" />
                </div>
              ) : device.key === 'iphonese' || device.key === 'ipadmini' ? null : (
                <div className="w-3.5 h-3.5 bg-black rounded-full shadow-sm" />
              )}
              <div className="flex items-center gap-1.5 text-[10px] font-mono drop-shadow-sm">
                <span className="font-bold">5G</span>
                <div className="w-4 h-2.5 border border-white/80 rounded-xs p-0.5 flex items-center">
                  <div className="h-full w-full bg-white rounded-xs" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-1 text-white">
              <span className="text-[#D8B4FE] font-bold text-xs flex items-center gap-1 drop-shadow-sm">
                ✕ Закрыть
              </span>
              <span className="font-extrabold text-xs tracking-tight text-white/95 drop-shadow-sm truncate max-w-[180px]">
                {slotTitle}
              </span>
              <div className="flex items-center gap-1 text-[#D8B4FE] font-bold text-xs drop-shadow-sm">
                <Shield className="w-3 h-3" />
                <span>TMA</span>
              </div>
            </div>
          </div>

          {/* HOME BAR */}
          {device.safeBottom > 0 && (
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-40 flex items-center justify-center pointer-events-none select-none">
              <div className="w-32 h-1 bg-white/45 rounded-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

