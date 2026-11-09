'use client';

import React from 'react';
import { DeviceSpec } from '@/lib/preview-devices';

interface PhoneSlotProps {
  id: string;
  device: DeviceSpec;
  rotated: boolean;
  showBezel: boolean;
  canRemove: boolean;
  hapticTriggered: boolean;
  allDevices: Record<string, DeviceSpec>;
  iframeRef: (el: HTMLIFrameElement | null) => void;
  onRotate: () => void;
  onChangeDevice: (newKey: string) => void;
  onRemove: () => void;
  onScreenshot: () => void;
  isDark: boolean;
  iframeSrc?: string;
  slotTitle?: string;
}

export function PhoneSlot({
  device,
  rotated,
  showBezel,
  canRemove,
  hapticTriggered,
  allDevices,
  iframeRef,
  onRotate,
  onChangeDevice,
  onRemove,
  onScreenshot,
  isDark,
  iframeSrc = '/demo',
  slotTitle = 'Viewer Mini App',
}: PhoneSlotProps) {
  // Dimensions based on rotation
  const width = rotated ? device.h : device.w;
  const height = rotated ? device.w : device.h;

  return (
    <div className="flex flex-col items-center gap-2.5 shrink-0 select-none">
      {/* SLOT CONTROLS ROW */}
      <div
        className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border shadow-sm transition-colors w-full max-w-full ${
          isDark ? 'bg-[#141324] border-white/10 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-800'
        }`}
      >
        {/* Device Switcher */}
        <select
          value={device.key}
          onChange={(e) => onChangeDevice(e.target.value)}
          className={`text-xs font-bold rounded-lg px-2 py-1 border focus:outline-none focus:ring-1 focus:ring-[#B833FF] cursor-pointer ${
            isDark ? 'bg-[#1C1A2E] border-white/10 text-zinc-200' : 'bg-zinc-100 border-zinc-300 text-zinc-800'
          }`}
        >
          {Object.entries(allDevices).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name} ({rotated ? `${v.h}×${v.w}` : `${v.w}×${v.h}`})
            </option>
          ))}
        </select>

        {/* Slot Action Buttons: Rotate, Screenshot, Close */}
        <div className="flex items-center gap-1">
          {/* Rotate 90 deg */}
          <button
            onClick={onRotate}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs transition-colors cursor-pointer ${
              rotated ? 'bg-[#B833FF] text-white border-[#B833FF]' : isDark ? 'bg-[#1C1A2E] border-white/10 hover:border-[#B833FF]' : 'bg-zinc-100 border-zinc-300 hover:border-[#B833FF]'
            }`}
            title="Повернуть на 90° (Альбомная / Портретная ориентация)"
          >
            🔄
          </button>

          {/* Screenshot */}
          <button
            onClick={onScreenshot}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs transition-colors cursor-pointer ${
              isDark ? 'bg-[#1C1A2E] border-white/10 hover:border-[#B833FF]' : 'bg-zinc-100 border-zinc-300 hover:border-[#B833FF]'
            }`}
            title="Сделать скриншот экрана"
          >
            📸
          </button>

          {/* Remove slot */}
          {canRemove && (
            <button
              onClick={onRemove}
              className="w-7 h-7 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 flex items-center justify-center text-xs transition-colors cursor-pointer"
              title="Закрыть этот экран"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* DEVICE FRAME CONTAINER */}
      <div
        style={{
          width: showBezel ? `${width + 28}px` : `${width}px`,
          height: showBezel ? `${height + 28}px` : `${height}px`,
          borderRadius: showBezel ? device.rad : '24px',
          padding: showBezel ? '14px' : '0px',
        }}
        className={`relative bg-[#0A0A0E] shadow-2xl border-4 overflow-hidden flex flex-col transition-all duration-150 ${
          showBezel ? 'border-[#2F2D48]' : 'border-zinc-800'
        } ${
          hapticTriggered
            ? 'border-[#B833FF] shadow-[0_0_35px_rgba(184,51,255,0.55)]'
            : ''
        }`}
      >
        {/* HARDWARE BUTTON ACCENTS (ONLY IF SHOW BEZEL AND NOT ROTATED) */}
        {showBezel && !rotated && (
          <>
            <div className="absolute -left-1.5 top-28 w-1.5 h-12 bg-[#3F3D5D] rounded-l-md pointer-events-none" />
            <div className="absolute -left-1.5 top-44 w-1.5 h-12 bg-[#3F3D5D] rounded-l-md pointer-events-none" />
            <div className="absolute -right-1.5 top-36 w-1.5 h-16 bg-[#3F3D5D] rounded-r-md pointer-events-none" />
          </>
        )}

        {/* SCREEN INNER */}
        <div
          style={{ borderRadius: showBezel ? '38px' : '20px' }}
          className="relative w-full h-full bg-[#111019] overflow-hidden"
        >
          {/* LIVE IFRAME (Full bleed from top: 0 to bottom: 0 like real Telegram Mini App) */}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="absolute inset-0 w-full h-full border-none bg-transparent"
            allow="camera; microphone; clipboard-write; geolocation;"
          />

          {/* TELEGRAM MINI APP HEADER OVERLAY */}
          <div className="absolute top-0 inset-x-0 z-40 pt-2 px-5 pb-2 bg-gradient-to-b from-black/60 via-black/20 to-transparent flex flex-col pointer-events-none select-none">
            {/* Status bar */}
            <div className="flex items-center justify-between text-white text-[11px] font-semibold h-6">
              <span className="tracking-tight font-bold drop-shadow-sm">9:41</span>

              {/* Dynamic Island or Android punch hole */}
              {device.dynamicIsland ? (
                <div className="w-24 h-5 bg-black rounded-full flex items-center justify-center gap-1.5 px-2 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-[#181824]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E0E14]" />
                </div>
              ) : device.key === 'iphonese' || device.key === 'ipadmini' ? null : (
                <div className="w-3.5 h-3.5 bg-black rounded-full shadow-sm" />
              )}

              <div className="flex items-center gap-1.5 text-[10px] drop-shadow-sm">
                <span className="font-bold">5G</span>
                <span>􀛨</span>
                <div className="w-4 h-2.5 border border-white/80 rounded-2xs p-0.5 flex items-center">
                  <div className="h-full w-full bg-white rounded-2xs" />
                </div>
              </div>
            </div>

            {/* Telegram top bar */}
            <div className="flex items-center justify-between mt-1 text-white">
              <span className="text-[#B833FF] font-bold text-xs flex items-center gap-1 drop-shadow-sm">
                ✕ Закрыть
              </span>
              <span className="font-extrabold text-xs tracking-tight text-white/95 drop-shadow-sm truncate max-w-[180px]">
                {slotTitle}
              </span>
              <div className="flex items-center gap-2 text-[#B833FF] font-bold text-xs drop-shadow-sm">
                <span>•••</span>
              </div>
            </div>
          </div>

          {/* HOME BAR (Only for modern devices with gesture bar) */}
          {device.key !== 'iphonese' && (
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center pointer-events-none select-none">
              <div className="w-32 h-1 bg-white/40 rounded-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
