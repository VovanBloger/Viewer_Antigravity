'use client';

import React, { useState, useEffect } from 'react';
import {
  Search,
  X,
  Wifi,
  Globe,
  Check,
  Copy,
  QrCode,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import QRCode from 'qrcode';
import { WORKSPACE_PRESETS, ANTIGRAVITY_THEMES, AntigravityTheme } from '@/lib/preview-devices';

interface CommandAction {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  onToggleInspect: () => void;
  onFitZoom: () => void;
  onToggleBoxModel: () => void;
  onCopyBatchPrompt: () => void;
  onRunAudit: () => void;
  onSelectPreset: (presetId: string) => void;
  onSelectTheme: (themeKey: AntigravityTheme['key']) => void;
}

export function CommandPaletteModal({
  open,
  onClose,
  isDark,
  onToggleInspect,
  onFitZoom,
  onToggleBoxModel,
  onCopyBatchPrompt,
  onRunAudit,
  onSelectPreset,
  onSelectTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  if (!open) return null;

  const actions: CommandAction[] = [
    {
      id: 'cmd-inspect',
      title: 'Переключить режим инспектора DOM и Z-Index слоёв',
      category: 'Инспектор',
      shortcut: 'Alt+I',
      onSelect: () => {
        onToggleInspect();
        onClose();
      },
    },
    {
      id: 'cmd-box-model',
      title: 'Показать / скрыть линейку Box Model и зоны Safe Area',
      category: 'Инспектор',
      shortcut: 'Alt+B',
      onSelect: () => {
        onToggleBoxModel();
        onClose();
      },
    },
    {
      id: 'cmd-copy-batch',
      title: 'Скопировать пакетный промпт для агента Antigravity',
      category: 'Агент Antigravity',
      shortcut: 'Alt+C',
      onSelect: () => {
        onCopyBatchPrompt();
        onClose();
      },
    },
    {
      id: 'cmd-audit',
      title: 'Запустить автоматический аудит вёрстки (Layout Linter)',
      category: 'Диагностика',
      onSelect: () => {
        onRunAudit();
        onClose();
      },
    },
    {
      id: 'cmd-fit',
      title: 'Автомасштаб всех экранов под размер окна (Fit to Viewport)',
      category: 'Холст',
      shortcut: 'Alt+0',
      onSelect: () => {
        onFitZoom();
        onClose();
      },
    },
    ...WORKSPACE_PRESETS.map((p) => ({
      id: `preset-${p.id}`,
      title: `Пресет экранов: ${p.name} — ${p.description}`,
      category: 'Пресеты устройств',
      onSelect: () => {
        onSelectPreset(p.id);
        onClose();
      },
    })),
    ...Object.values(ANTIGRAVITY_THEMES).map((t) => ({
      id: `theme-${t.key}`,
      title: `Тема интерфейса: ${t.name}`,
      category: 'Темы Antigravity',
      onSelect: () => {
        onSelectTheme(t.key);
        onClose();
      },
    })),
  ];

  const filtered = actions.filter(
    (a) =>
      a.title.toLowerCase().includes(query.toLowerCase()) ||
      a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Командная палитра Antigravity"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
    >
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#131320] border-white/15 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <Search className="w-4 h-4 text-[#B833FF] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Введите команду, пресет экранов или тему (например, iOS vs Android, Аудит)..."
            aria-label="Поиск команды"
            className="w-full bg-transparent text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть командную палитру"
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Команды по запросу «{query}» не найдены
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                className={`w-full px-3 py-2.5 rounded-xl text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                  isDark ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{item.title}</div>
                  <div className="text-[10px] text-slate-400">{item.category}</div>
                </div>
                {item.shortcut && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded border border-white/15 bg-black/20 text-[#D8B4FE] shrink-0">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface MobileTunnelModalProps {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  localWifiUrl: string;
  publicAppUrl: string;
}

export function MobileTunnelModal({
  open,
  onClose,
  isDark,
  localWifiUrl,
  publicAppUrl,
}: MobileTunnelModalProps) {
  const [copiedType, setCopiedType] = useState<'wifi' | 'https' | 'qr' | null>(null);
  const [qrSource, setQrSource] = useState<'https' | 'wifi'>('https');
  const [targetRoute, setTargetRoute] = useState<'/demo' | ''>('/demo');
  const [qrSvgMarkup, setQrSvgMarkup] = useState<string>('');

  const resolvedBaseUrl =
    qrSource === 'https'
      ? publicAppUrl.startsWith('http') && !publicAppUrl.includes('MY_APP_URL')
        ? publicAppUrl.replace(/\/$/, '')
        : typeof window !== 'undefined'
        ? window.location.origin
        : publicAppUrl.replace(/\/$/, '')
      : localWifiUrl.replace(/\/$/, '');

  const activeQrUrl = `${resolvedBaseUrl}${targetRoute}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toString(activeQrUrl, {
      type: 'svg',
      margin: 1,
      width: 176,
      color: {
        dark: '#0F0E17',
        light: '#FFFFFF',
      },
    })
      .then((svg) => {
        if (!cancelled) setQrSvgMarkup(svg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, activeQrUrl]);

  if (!open) return null;

  const copyUrl = (type: 'wifi' | 'https' | 'qr', url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const cleanHttpsBase =
    publicAppUrl.startsWith('http') && !publicAppUrl.includes('MY_APP_URL')
      ? publicAppUrl.replace(/\/$/, '')
      : typeof window !== 'undefined'
      ? window.location.origin
      : publicAppUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Тестирование на реальном смартфоне"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-5 border shadow-2xl space-y-4 ${
          isDark
            ? 'bg-[#141422] border-white/15 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-[#B833FF]" />
            <h3 className="font-bold text-sm">
              Подключение реального смартфона (QR-код, LAN & HTTPS)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно подключения смартфона"
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SCANNABLE QR CODE HERO CARD */}
        <div
          data-testid="mobile-qr-card"
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center gap-4 ${
            isDark
              ? 'bg-[#1B1A2E]/90 border-[#B833FF]/40'
              : 'bg-purple-50/70 border-purple-200'
          }`}
        >
          {/* Crisp White QR Frame for Instant Phone Camera Scanning */}
          <div className="p-2.5 rounded-2xl bg-white shadow-lg border border-purple-200 shrink-0 flex flex-col items-center">
            {qrSvgMarkup ? (
              <div
                data-testid="mobile-qr-svg"
                className="w-40 h-40 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: qrSvgMarkup }}
              />
            ) : (
              <div className="w-40 h-40 flex items-center justify-center text-xs text-slate-400">
                Генерация QR...
              </div>
            )}
            <span className="mt-1 text-[10px] font-mono font-bold text-slate-700 flex items-center gap-1">
              <Smartphone className="w-3 h-3 text-[#B833FF]" />
              Наведите камеру телефона
            </span>
          </div>

          {/* QR Controls: Source (HTTPS vs LAN) & Target Route (/demo vs /) */}
          <div className="flex-1 min-w-0 space-y-2.5 w-full">
            <div>
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>Быстрый вход по QR-коду</span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Отсканируйте камерой iPhone или Android, чтобы сразу открыть приложение на телефоне:
              </p>
            </div>

            {/* Switch QR Source: HTTPS Tunnel vs Local Wi-Fi */}
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-slate-400">Канал подключения:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setQrSource('https')}
                  className={`py-1.5 px-2.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    qrSource === 'https'
                      ? 'bg-[#B833FF] border-[#B833FF] text-white shadow-xs'
                      : isDark
                      ? 'bg-black/30 border-white/10 text-slate-300 hover:bg-white/5'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>HTTPS (Облако)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrSource('wifi')}
                  className={`py-1.5 px-2.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    qrSource === 'wifi'
                      ? 'bg-[#B833FF] border-[#B833FF] text-white shadow-xs'
                      : isDark
                      ? 'bg-black/30 border-white/10 text-slate-300 hover:bg-white/5'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Локальный Wi-Fi</span>
                </button>
              </div>
            </div>

            {/* Switch Target Route: /demo Mini App vs Full Workbench */}
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-slate-400">Что открыть на смартфоне:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setTargetRoute('/demo')}
                  className={`py-1 px-2 rounded-lg border text-[10px] font-semibold cursor-pointer ${
                    targetRoute === '/demo'
                      ? isDark
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-emerald-100 border-emerald-500 text-emerald-900 font-bold'
                      : isDark
                      ? 'bg-white/5 border-white/10 text-slate-400'
                      : 'bg-white border-slate-300 text-slate-600'
                  }`}
                >
                  Только Mini App (/demo)
                </button>
                <button
                  type="button"
                  onClick={() => setTargetRoute('')}
                  className={`py-1 px-2 rounded-lg border text-[10px] font-semibold cursor-pointer ${
                    targetRoute === ''
                      ? isDark
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-emerald-100 border-emerald-500 text-emerald-900 font-bold'
                      : isDark
                      ? 'bg-white/5 border-white/10 text-slate-400'
                      : 'bg-white border-slate-300 text-slate-600'
                  }`}
                >
                  Весь стенд Viewer 2.0
                </button>
              </div>
            </div>

            {/* Active QR URL display + copy */}
            <div className="pt-0.5 flex items-center gap-1.5">
              <div
                className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border font-mono text-[10px] truncate ${
                  isDark
                    ? 'bg-black/40 border-white/10 text-[#D8B4FE]'
                    : 'bg-white border-slate-300 text-purple-900'
                }`}
                title={activeQrUrl}
              >
                {activeQrUrl}
              </div>
              <button
                type="button"
                onClick={() => copyUrl('qr', activeQrUrl)}
                className="px-2.5 py-1.5 rounded-lg bg-[#B833FF] hover:bg-[#a224e6] text-white text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copiedType === 'qr' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedType === 'qr' ? 'Ок' : 'Копия'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* DIRECT LINKS CARDS (LAN & HTTPS) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className={`p-3 rounded-xl border space-y-1.5 ${
              isDark ? 'bg-[#181828] border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-[#B833FF]" />
                <span>Локальный Wi-Fi</span>
              </span>
              <button
                type="button"
                onClick={() => setQrSource('wifi')}
                className="text-[10px] text-[#B833FF] hover:underline cursor-pointer"
              >
                Показать QR
              </button>
            </div>
            <div className="font-mono text-[11px] font-bold break-all text-[#B833FF]">
              {localWifiUrl}
              {targetRoute}
            </div>
            <button
              type="button"
              onClick={() => copyUrl('wifi', `${localWifiUrl}${targetRoute}`)}
              className={`w-full py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                isDark
                  ? 'bg-white/10 border-white/15 text-white hover:bg-white/15'
                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
              }`}
            >
              {copiedType === 'wifi' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedType === 'wifi' ? 'Скопировано' : 'Копировать LAN'}</span>
            </button>
          </div>

          <div
            className={`p-3 rounded-xl border space-y-1.5 ${
              isDark ? 'bg-[#181828] border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>Telegram HTTPS</span>
              </span>
              <a
                href={`${cleanHttpsBase}${targetRoute}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-emerald-400 hover:underline flex items-center gap-0.5"
              >
                <span>Открыть</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div
              className="font-mono text-[11px] font-bold truncate"
              title={`${cleanHttpsBase}${targetRoute}`}
            >
              {cleanHttpsBase}
              {targetRoute}
            </div>
            <button
              type="button"
              onClick={() => copyUrl('https', `${cleanHttpsBase}${targetRoute}`)}
              className={`w-full py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                isDark
                  ? 'bg-white/10 border-white/15 text-white hover:bg-white/15'
                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
              }`}
            >
              {copiedType === 'https' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedType === 'https' ? 'Скопировано' : 'Копировать HTTPS'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
