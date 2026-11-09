'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Sun, Moon } from 'lucide-react';
import { PREVIEW_DEVICES, DeviceSpec, CANVAS_BACKGROUNDS } from '@/lib/preview-devices';
import { PhoneSlot } from '@/components/preview/PhoneSlot';

interface DeviceSlotState {
  id: string;
  deviceKey: string;
  rotated: boolean;
}

interface LayerSummary {
  tag: string;
  className: string;
  textSnippet: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  width: number;
  height: number;
  roleHint?: string;
}

interface ElementInfo {
  tag: string;
  id?: string;
  className: string;
  textSnippet: string;
  rect: { top: number; left: number; width: number; height: number };
  selector: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  layerIndex?: number;
  totalLayers?: number;
  coveringTag?: string;
}

interface StyleTunerState {
  bgOpacity: number; // 0 - 100% (только для фона, не трогая дочерние элементы!)
  widthVal: number;
  widthUnit: 'px' | '%' | 'auto';
  heightVal: number;
  heightUnit: 'px' | '%' | 'dvh' | 'auto';
  radiusVal: number;
  align: 'left' | 'center' | 'right' | 'none'; // выравнивание по левому/правому краю и по центру
}

const DEFAULT_TUNER_STATE: StyleTunerState = {
  bgOpacity: 0,
  widthVal: 386,
  widthUnit: 'px',
  heightVal: 90,
  heightUnit: 'px',
  radiusVal: 0,
  align: 'none',
};

/**
 * Извлекает имя React-компонента, имя файла и строку из Fiber в dev-режиме Next.js
 */
function getReactSourceInfo(target: any): { componentName?: string; sourceFile?: string; sourceLine?: number } {
  try {
    if (!target) return {};
    const fiberKey = Object.keys(target).find(
      k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return {};

    const fiber = target[fiberKey];
    let sourceFile: string | undefined;
    let sourceLine: number | undefined;
    let componentName: string | undefined;

    let curr = fiber;
    let depth = 0;
    while (curr && depth < 20) {
      const src = curr._debugSource || curr._source || curr.memoizedProps?.__source || curr._debugOwner?._debugSource;
      if (src && !sourceFile) {
        sourceFile = src.fileName || src.file;
        sourceLine = src.lineNumber || src.line;
      }

      if (!componentName && typeof curr.type === 'function') {
        const name = curr.type.displayName || curr.type.name;
        if (name && name !== 'Anonymous') {
          componentName = name;
        }
      } else if (!componentName && curr._debugOwner && typeof curr._debugOwner.type === 'function') {
        const name = curr._debugOwner.type.displayName || curr._debugOwner.type.name;
        if (name && name !== 'Anonymous') {
          componentName = name;
        }
      }

      if (sourceFile && componentName) break;
      curr = curr.return;
      depth++;
    }

    if (!sourceFile && fiber?._debugStack) {
      try {
        const stackStr = String(fiber._debugStack);
        const match = stackStr.match(/(?:at\s+)?([^\s()]+):(\d+):(\d+)/) || stackStr.match(/\((.+?):(\d+):(\d+)\)/);
        if (match) {
          sourceFile = match[1];
          sourceLine = parseInt(match[2], 10);
        }
      } catch {}
    }

    if (sourceFile) {
      sourceFile = sourceFile.replace(/\\/g, '/');
      const parts = sourceFile.split('/');
      const componentsIdx = parts.lastIndexOf('components');
      const appIdx = parts.lastIndexOf('app');
      const libIdx = parts.lastIndexOf('lib');
      const bestIdx = Math.max(componentsIdx, appIdx, libIdx);
      if (bestIdx !== -1) {
        sourceFile = parts.slice(bestIdx).join('/');
      }
    }

    return { componentName, sourceFile, sourceLine };
  } catch {
    return {};
  }
}

/**
 * Управляет постоянной зеленой подсветкой выбранного элемента внутри iframe
 */
function updateSelectedOverlay(target: HTMLElement, doc: Document) {
  try {
    let selOverlay = doc.getElementById('__antigravity_selected_overlay__');
    if (!selOverlay) {
      selOverlay = doc.createElement('div');
      selOverlay.id = '__antigravity_selected_overlay__';
      selOverlay.style.position = 'fixed';
      selOverlay.style.pointerEvents = 'none';
      selOverlay.style.zIndex = '999998';
      selOverlay.style.border = '2px solid #10B981';
      selOverlay.style.background = 'rgba(16, 185, 129, 0.16)';
      selOverlay.style.borderRadius = '6px';
      selOverlay.style.transition = 'all 80ms ease-out';
      selOverlay.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.4), 0 0 14px rgba(16, 185, 129, 0.45)';

      const badge = doc.createElement('div');
      badge.id = '__antigravity_selected_badge__';
      badge.style.position = 'absolute';
      badge.style.bottom = '100%';
      badge.style.left = '0';
      badge.style.marginBottom = '4px';
      badge.style.background = '#064E3B';
      badge.style.color = '#A7F3D0';
      badge.style.border = '1px solid #10B981';
      badge.style.fontSize = '10px';
      badge.style.fontFamily = 'ui-monospace, monospace';
      badge.style.fontWeight = 'bold';
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '6px';
      badge.style.whiteSpace = 'nowrap';
      badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
      selOverlay.appendChild(badge);

      doc.body.appendChild(selOverlay);
    }
    const r = target.getBoundingClientRect();
    selOverlay.style.display = 'block';
    selOverlay.style.top = `${r.top}px`;
    selOverlay.style.left = `${r.left}px`;
    selOverlay.style.width = `${r.width}px`;
    selOverlay.style.height = `${r.height}px`;

    const badge = doc.getElementById('__antigravity_selected_badge__');
    if (badge) {
      badge.textContent = `<${target.tagName.toLowerCase()}> ${Math.round(r.width)}×${Math.round(r.height)}px`;
    }
  } catch {}
}

function clearSelectedOverlay(doc?: Document | null) {
  try {
    if (!doc) return;
    const el = doc.getElementById('__antigravity_selected_overlay__');
    if (el) el.remove();
  } catch {}
}

export default function LivePreviewPage() {
  const [bgKey, setBgKey] = useState('cyber');
  const [showBezel, setShowBezel] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [showZoomSlider, setShowZoomSlider] = useState(false);
  const [targetUrl, setTargetUrl] = useState<string>('/demo');
  const [inputUrl, setInputUrl] = useState<string>('/demo');
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
  const [liveClasses, setLiveClasses] = useState('');
  const inspectedTargetRef = useRef<HTMLElement | null>(null);
  const [noteText, setNoteText] = useState('');
  const [copied, setCopied] = useState(false);

  // Слои под курсором (elementsFromPoint) & управление перекрывающими слоями
  const [layers, setLayers] = useState<LayerSummary[]>([]);
  const [activeLayerIndex, setActiveLayerIndex] = useState<number>(0);
  const stackedElementsRef = useRef<HTMLElement[]>([]);
  const inspectedDocRef = useRef<Document | null>(null);
  const hiddenElementsRef = useRef<Array<{ el: HTMLElement; prevDisplay: string; prevPointerEvents: string }>>([]);
  const [hiddenCount, setHiddenCount] = useState<number>(0);
  const [inspectedSlotName, setInspectedSlotName] = useState<string>('');

  // Визуальные регуляторы стиля (прозрачность, заливка, размеры, скругление)
  const [tunerState, setTunerState] = useState<StyleTunerState>(DEFAULT_TUNER_STATE);

  const applyTunerStyle = (changes: Partial<StyleTunerState>) => {
    const next = { ...tunerState, ...changes };
    setTunerState(next);

    const el = inspectedTargetRef.current;
    const doc = inspectedDocRef.current;
    if (!el) return;

    // ВАЖНО: Ни в коем случае не трогаем общую прозрачность элемента (el.style.opacity),
    // чтобы иконки, текст и дочерние элементы оставались на 100% чёткими!
    el.style.opacity = '1';

    // 1. Прозрачность фона / заливки (ТОЛЬКО для фона, не затрагивая детей)
    if (changes.bgOpacity !== undefined) {
      if (next.bgOpacity === 0) {
        el.style.background = 'transparent';
        el.style.backgroundColor = 'transparent';
        el.style.backgroundImage = 'none';
        if (el.tagName.toLowerCase() === 'path' || el.tagName.toLowerCase() === 'svg') {
          el.style.fill = 'transparent';
          el.setAttribute('fill', 'transparent');
        }
        // Затрагиваем только фон панели SVG, НЕ трогая иконки и текст внутри кнопок
        el.querySelectorAll('path, svg').forEach((s) => {
          if (!s.closest('button, .nav-tab-btn, [role="button"]')) {
            (s as HTMLElement).style.fill = 'transparent';
            s.setAttribute('fill', 'transparent');
          }
        });
        el.querySelectorAll('linearGradient stop').forEach((st) => {
          st.setAttribute('stop-opacity', '0');
          st.setAttribute('stop-color', 'transparent');
        });
      } else {
        const alpha = (next.bgOpacity / 100).toFixed(2);
        el.style.backgroundColor = isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
        el.style.backgroundImage = 'none';
        if (el.tagName.toLowerCase() === 'path' || el.tagName.toLowerCase() === 'svg') {
          el.style.fill = isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
          el.setAttribute('fill', isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`);
        }
        el.querySelectorAll('path, svg').forEach((s) => {
          if (!s.closest('button, .nav-tab-btn, [role="button"]')) {
            (s as HTMLElement).style.fill = isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
            s.setAttribute('fill', isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`);
          }
        });
        el.querySelectorAll('linearGradient stop').forEach((st) => {
          st.setAttribute('stop-opacity', alpha);
        });
      }
    }

    // 2. Выравнивание (по левому/правому краю и по центру)
    if (changes.align !== undefined) {
      if (next.align === 'left') {
        el.style.textAlign = 'left';
        el.style.alignSelf = 'flex-start';
        el.style.justifySelf = 'start';
      } else if (next.align === 'center') {
        el.style.textAlign = 'center';
        el.style.alignSelf = 'center';
        el.style.justifySelf = 'center';
      } else if (next.align === 'right') {
        el.style.textAlign = 'right';
        el.style.alignSelf = 'flex-end';
        el.style.justifySelf = 'end';
      } else {
        el.style.textAlign = '';
        el.style.alignSelf = '';
        el.style.justifySelf = '';
      }
    }

    // 3. Ширина
    if (changes.widthVal !== undefined || changes.widthUnit !== undefined) {
      if (next.widthUnit === 'auto') {
        el.style.width = 'auto';
      } else if (next.widthUnit === '%') {
        el.style.width = `${next.widthVal}%`;
      } else {
        el.style.width = `${next.widthVal}px`;
      }
    }

    // 3. Высота
    if (changes.heightVal !== undefined || changes.heightUnit !== undefined) {
      if (next.heightUnit === 'auto') {
        el.style.height = 'auto';
      } else if (next.heightUnit === '%') {
        el.style.height = `${next.heightVal}%`;
      } else if (next.heightUnit === 'dvh') {
        el.style.height = `${next.heightVal}dvh`;
      } else {
        el.style.height = `${next.heightVal}px`;
      }
    }

    // 4. Скругление
    if (changes.radiusVal !== undefined) {
      el.style.borderRadius = `${next.radiusVal}px`;
    }

    // Обновляем зеленую подсветку и геометрию
    if (doc) {
      updateSelectedOverlay(el, doc);
    }
    const newRect = el.getBoundingClientRect();
    setSelectedElement(prev => (prev ? {
      ...prev,
      rect: {
        top: Math.round(newRect.top),
        left: Math.round(newRect.left),
        width: Math.round(newRect.width),
        height: Math.round(newRect.height),
      }
    } : null));
  };

  const handleApplyLiveStyle = (newClasses: string) => {
    setLiveClasses(newClasses);
    if (inspectedTargetRef.current) {
      inspectedTargetRef.current.className = newClasses;
      if (inspectedDocRef.current) {
        updateSelectedOverlay(inspectedTargetRef.current, inspectedDocRef.current);
      }
    }
    setSelectedElement(prev => (prev ? { ...prev, className: newClasses } : null));
  };

  /**
   * Выбирает конкретный слой из стека в точке клика (верхний, под ним, ещё глубже)
   */
  const selectElementFromStack = (index: number, docOverride?: Document, elementsOverride?: HTMLElement[]) => {
    const elements = elementsOverride || stackedElementsRef.current;
    const doc = docOverride || inspectedDocRef.current;
    if (!elements || index < 0 || index >= elements.length) return;
    const target = elements[index];
    if (!target) return;

    setActiveLayerIndex(index);
    inspectedTargetRef.current = target;
    const className = typeof target.className === 'string' ? target.className : (target.className as any)?.baseVal || '';
    setLiveClasses(className);

    const rect = target.getBoundingClientRect();
    const tag = target.tagName.toLowerCase();
    const textSnippet = target.innerText?.trim()?.slice(0, 100) || '';

    const path: string[] = [];
    let curr: HTMLElement | null = target;
    while (curr && curr.tagName !== 'BODY' && curr.tagName !== 'HTML' && path.length < 5) {
      let part = curr.tagName.toLowerCase();
      if (curr.id) {
        part += `#${curr.id}`;
      } else if (curr.className && typeof curr.className === 'string') {
        const cls = curr.className.split(' ').filter(c => !c.startsWith('hover:') && !c.startsWith('focus:'))[0];
        if (cls) part += `.${cls}`;
      }
      path.unshift(part);
      curr = curr.parentElement;
    }
    const selector = path.join(' > ');
    const { componentName, sourceFile, sourceLine } = getReactSourceInfo(target);

    setSelectedElement({
      tag,
      id: target.id || undefined,
      className,
      textSnippet,
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selector,
      componentName,
      sourceFile,
      sourceLine,
      layerIndex: index,
      totalLayers: elements.length,
      coveringTag: index > 0 && elements[0] ? elements[0].tagName.toLowerCase() : undefined,
    });

    try {
      const win = doc?.defaultView || window;
      const comp = win.getComputedStyle(target);
      const currentOpacity = comp ? Math.round(parseFloat(comp.opacity || '1') * 100) : 100;
      const currentRadius = comp ? parseInt(comp.borderRadius || '0', 10) || 0 : 0;
      const isBgTransparent = !comp || comp.backgroundColor === 'transparent' || comp.backgroundColor === 'rgba(0, 0, 0, 0)';
      const textAlignVal = comp ? comp.textAlign : '';
      const currentAlign: 'left' | 'center' | 'right' | 'none' =
        textAlignVal === 'center' ? 'center' :
        textAlignVal === 'right' ? 'right' :
        textAlignVal === 'left' ? 'left' : 'none';

      setTunerState({
        bgOpacity: isBgTransparent ? 0 : 100,
        widthVal: Math.round(rect.width),
        widthUnit: 'px',
        heightVal: Math.round(rect.height),
        heightUnit: 'px',
        radiusVal: currentRadius,
        align: currentAlign,
      });
    } catch {}

    if (doc) {
      updateSelectedOverlay(target, doc);
    }
  };

  /**
   * Выбирает элемент напрямую (например, клик по родителю или потомку в DOM)
   */
  const selectElementDirectly = (target: HTMLElement) => {
    const doc = inspectedDocRef.current;
    if (!target || !doc) return;

    inspectedTargetRef.current = target;
    const className = typeof target.className === 'string' ? target.className : (target.className as any)?.baseVal || '';
    setLiveClasses(className);

    const rect = target.getBoundingClientRect();
    const tag = target.tagName.toLowerCase();
    const textSnippet = target.innerText?.trim()?.slice(0, 100) || '';

    const path: string[] = [];
    let curr: HTMLElement | null = target;
    while (curr && curr.tagName !== 'BODY' && curr.tagName !== 'HTML' && path.length < 5) {
      let part = curr.tagName.toLowerCase();
      if (curr.id) {
        part += `#${curr.id}`;
      } else if (curr.className && typeof curr.className === 'string') {
        const cls = curr.className.split(' ').filter(c => !c.startsWith('hover:') && !c.startsWith('focus:'))[0];
        if (cls) part += `.${cls}`;
      }
      path.unshift(part);
      curr = curr.parentElement;
    }
    const selector = path.join(' > ');
    const { componentName, sourceFile, sourceLine } = getReactSourceInfo(target);

    const idx = stackedElementsRef.current.indexOf(target);
    if (idx !== -1) {
      setActiveLayerIndex(idx);
    }

    setSelectedElement({
      tag,
      id: target.id || undefined,
      className,
      textSnippet,
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selector,
      componentName,
      sourceFile,
      sourceLine,
      layerIndex: idx !== -1 ? idx : undefined,
      totalLayers: stackedElementsRef.current.length || undefined,
      coveringTag: idx > 0 && stackedElementsRef.current[0] ? stackedElementsRef.current[0].tagName.toLowerCase() : undefined,
    });

    try {
      const win = doc?.defaultView || window;
      const comp = win.getComputedStyle(target);
      const currentOpacity = comp ? Math.round(parseFloat(comp.opacity || '1') * 100) : 100;
      const currentRadius = comp ? parseInt(comp.borderRadius || '0', 10) || 0 : 0;
      const isBgTransparent = !comp || comp.backgroundColor === 'transparent' || comp.backgroundColor === 'rgba(0, 0, 0, 0)';
      const textAlignVal = comp ? comp.textAlign : '';
      const currentAlign: 'left' | 'center' | 'right' | 'none' =
        textAlignVal === 'center' ? 'center' :
        textAlignVal === 'right' ? 'right' :
        textAlignVal === 'left' ? 'left' : 'none';

      setTunerState({
        bgOpacity: isBgTransparent ? 0 : 100,
        widthVal: Math.round(rect.width),
        widthUnit: 'px',
        heightVal: Math.round(rect.height),
        heightUnit: 'px',
        radiusVal: currentRadius,
        align: currentAlign,
      });
    } catch {}

    updateSelectedOverlay(target, doc);
  };

  const handleSelectParent = () => {
    const el = inspectedTargetRef.current;
    if (!el || !el.parentElement || el.parentElement.tagName === 'BODY' || el.parentElement.tagName === 'HTML') return;
    selectElementDirectly(el.parentElement);
  };

  const handleSelectChild = () => {
    const el = inspectedTargetRef.current;
    if (!el || !el.firstElementChild) return;
    selectElementDirectly(el.firstElementChild as HTMLElement);
  };

  const handleToggleHideCurrentElement = () => {
    const el = inspectedTargetRef.current;
    if (!el) return;
    const prevDisplay = el.style.display || '';
    const prevPointerEvents = el.style.pointerEvents || '';
    el.style.display = 'none';
    hiddenElementsRef.current.push({ el, prevDisplay, prevPointerEvents });
    setHiddenCount(hiddenElementsRef.current.length);

    // Если есть слои под ним — автоматически выбираем следующий слой
    if (layers.length > 1 && activeLayerIndex < layers.length - 1) {
      selectElementFromStack(activeLayerIndex + 1);
    } else if (el.parentElement && el.parentElement.tagName !== 'BODY') {
      selectElementDirectly(el.parentElement);
    }
  };

  const handleRestoreHiddenElements = () => {
    hiddenElementsRef.current.forEach(item => {
      try {
        item.el.style.display = item.prevDisplay;
        item.el.style.pointerEvents = item.prevPointerEvents;
      } catch {}
    });
    hiddenElementsRef.current = [];
    setHiddenCount(0);
    if (inspectedTargetRef.current && inspectedDocRef.current) {
      updateSelectedOverlay(inspectedTargetRef.current, inspectedDocRef.current);
    }
  };

  const handleDeselect = () => {
    setSelectedElement(null);
    inspectedTargetRef.current = null;
    clearSelectedOverlay(inspectedDocRef.current);
    setLayers([]);
    setActiveLayerIndex(0);
  };

  // Dynamic Device Slots (Multi-Screen Workspace inspired by Mobile View)
  const [slots, setSlots] = useState<DeviceSlotState[]>([
    { id: 'slot-1', deviceKey: 'iphone16pro', rotated: false },
  ]);

  // Modals & Panels
  const [showQrModal, setShowQrModal] = useState(false);

  // Tunnel state
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelQr, setTunnelQr] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const localWifiUrl = 'http://192.168.1.93:3050';
  const [wifiQr, setWifiQr] = useState<string | null>(null);

  // Haptic Visualizer
  const [hapticTriggered, setHapticTriggered] = useState(false);

  // Iframe Refs Map for multi-screen sync
  const iframesRef = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const zoomSliderRef = useRef<HTMLDivElement>(null);

  const currentBg = CANVAS_BACKGROUNDS.find(b => b.key === bgKey) || CANVAS_BACKGROUNDS[0];
  const isDark = currentBg.isDark;

  // Sound generator for Web Haptics
  const playHapticAudio = (type: string) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const freq = type === 'selection' ? 1200 : type === 'medium' ? 650 : 850;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);

      osc.start();
      osc.stop(ctx.currentTime + 0.025);
    } catch {
      // AudioContext muted or not allowed
    }
  };

  // Listen to haptic events from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'tg:haptic') {
        const type = e.data.detail?.type || 'light';
        setHapticTriggered(true);
        playHapticAudio(type);
        setTimeout(() => setHapticTriggered(false), 260);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Multi-Device Scroll & Click Synchronizer across all active slots
  useEffect(() => {
    if (slots.length < 2) return;

    let isSyncing = false;

    const iframes = Array.from(iframesRef.current.values()).filter(Boolean);

    const cleanupFns: Array<() => void> = [];

    iframes.forEach((sourceIframe, srcIdx) => {
      const doc = sourceIframe.contentDocument || sourceIframe.contentWindow?.document;
      if (!doc) return;

      // Synchronize internal scroll
      const handleScroll = (e: Event) => {
        if (isSyncing) return;
        isSyncing = true;
        try {
          const src = e.target as HTMLElement;
          if (src && src.scrollHeight > src.clientHeight) {
            const scrollPct = src.scrollTop / (src.scrollHeight - src.clientHeight || 1);

            iframes.forEach((otherIframe, otherIdx) => {
              if (srcIdx === otherIdx) return;
              const otherDoc = otherIframe.contentDocument || otherIframe.contentWindow?.document;
              if (otherDoc) {
                const target = otherDoc.querySelector('main') || otherDoc.querySelector('.overflow-y-auto') || otherDoc.documentElement;
                if (target) {
                  target.scrollTop = scrollPct * (target.scrollHeight - target.clientHeight);
                }
              }
            });
          }
        } catch {}
        setTimeout(() => { isSyncing = false; }, 35);
      };

      // Synchronize clicks on buttons / tabs
      const handleClick = (e: MouseEvent) => {
        if (isSyncing) return;
        try {
          const el = e.target as HTMLElement;
          const clickable = el?.closest('button, a, [role="button"]') as HTMLElement;
          if (!clickable) return;

          const text = clickable.innerText?.trim();
          if (text) {
            iframes.forEach((otherIframe, otherIdx) => {
              if (srcIdx === otherIdx) return;
              const otherDoc = otherIframe.contentDocument || otherIframe.contentWindow?.document;
              if (otherDoc) {
                const candidates = Array.from(otherDoc.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
                const match = candidates.find(c => c.innerText?.trim() === text);
                if (match && match !== clickable) {
                  isSyncing = true;
                  match.click();
                  setTimeout(() => { isSyncing = false; }, 60);
                }
              }
            });
          }
        } catch {}
      };

      doc.addEventListener('scroll', handleScroll, true);
      doc.addEventListener('click', handleClick, true);

      cleanupFns.push(() => {
        doc.removeEventListener('scroll', handleScroll, true);
        doc.removeEventListener('click', handleClick, true);
      });
    });

    return () => {
      cleanupFns.forEach(fn => fn());
    };
  }, [slots]);

  // DevTools Click-to-Inspect implementation (attaches to all active slots)
  useEffect(() => {
    const iframes = Array.from(iframesRef.current.entries()).filter(([_, el]) => Boolean(el));
    if (iframes.length === 0) return;

    const cleanupFns: Array<() => void> = [];

    iframes.forEach(([slotId, iframe]) => {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument || iframe.contentWindow?.document || null;
      } catch {
        return;
      }
      if (!doc || !doc.body) return;

      if (!isInspectMode) {
        doc.body.style.cursor = 'default';
        const oldOverlay = doc.getElementById('__antigravity_hover_overlay__');
        if (oldOverlay) oldOverlay.remove();
        return;
      }

      doc.body.style.cursor = 'crosshair';

      let overlay = doc.getElementById('__antigravity_hover_overlay__');
      if (!overlay) {
        overlay = doc.createElement('div');
        overlay.id = '__antigravity_hover_overlay__';
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '999999';
        overlay.style.border = '2px solid #B833FF';
        overlay.style.background = 'rgba(184, 51, 255, 0.22)';
        overlay.style.borderRadius = '6px';
        overlay.style.transition = 'all 45ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        overlay.style.display = 'none';

        const tooltip = doc.createElement('div');
        tooltip.id = '__antigravity_hover_tooltip__';
        tooltip.style.position = 'absolute';
        tooltip.style.bottom = '100%';
        tooltip.style.left = '0';
        tooltip.style.marginBottom = '5px';
        tooltip.style.background = '#0F0E1A';
        tooltip.style.color = '#FFFFFF';
        tooltip.style.fontSize = '11px';
        tooltip.style.fontFamily = 'ui-monospace, monospace';
        tooltip.style.fontWeight = 'bold';
        tooltip.style.padding = '4px 10px';
        tooltip.style.borderRadius = '8px';
        tooltip.style.border = '1px solid rgba(184, 51, 255, 0.6)';
        tooltip.style.whiteSpace = 'nowrap';
        tooltip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.7)';
        tooltip.style.pointerEvents = 'none';
        overlay.appendChild(tooltip);

        doc.body.appendChild(overlay);
      }

      const tooltip = doc.getElementById('__antigravity_hover_tooltip__');

      const handleMouseMove = (e: MouseEvent) => {
        if (!isInspectMode || !doc) return;
        const target = e.target as HTMLElement;
        if (!target || target === overlay || target.id?.startsWith('__antigravity')) return;

        const rect = target.getBoundingClientRect();
        if (overlay) {
          overlay.style.display = 'block';
          overlay.style.top = `${rect.top}px`;
          overlay.style.left = `${rect.left}px`;
          overlay.style.width = `${rect.width}px`;
          overlay.style.height = `${rect.height}px`;
        }

        if (tooltip) {
          const tag = target.tagName.toLowerCase();
          let classSnippet = '';
          const cls = typeof target.className === 'string' ? target.className : (target.className as any)?.baseVal || '';
          if (cls) {
            const parts = cls.split(' ').filter(Boolean).slice(0, 2);
            if (parts.length > 0) classSnippet = '.' + parts.join('.');
          }
          const dims = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

          const stackedAtPoint = (doc.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[])
            .filter(el => el && el.tagName !== 'HTML' && el.tagName !== 'BODY' && !el.id?.startsWith('__antigravity'));
          const stackBadge = stackedAtPoint.length > 1
            ? ` <span style="background:#B833FF;color:white;padding:1px 5px;border-radius:4px;font-size:9.5px;margin-left:6px;font-weight:900;">🥞 ${stackedAtPoint.length} слоя</span>`
            : '';

          tooltip.innerHTML = `<span style="color:#D8B4FE;">${tag}${classSnippet}</span> <span style="color:#A1A1AA;font-weight:normal;margin-left:6px;">${dims}</span>${stackBadge}`;
        }
      };

      const handleClick = (e: MouseEvent) => {
        if (!isInspectMode || !doc) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        if (!target || target === overlay || target.id?.startsWith('__antigravity')) return;

        // Получаем все элементы под курсором в порядке Z-Index (сверху вниз)
        const rawElements = (doc.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]) || [];
        const validElements = rawElements.filter(el => {
          if (!el) return false;
          const tn = el.tagName;
          if (tn === 'HTML' || tn === 'BODY') return false;
          if (el.id?.startsWith('__antigravity')) return false;
          return true;
        });

        if (!validElements.includes(target) && target.tagName !== 'HTML' && target.tagName !== 'BODY') {
          validElements.unshift(target);
        }

        stackedElementsRef.current = validElements;
        inspectedDocRef.current = doc;

        const slot = slots.find(s => s.id === slotId) || slots[0];
        const spec = PREVIEW_DEVICES[slot?.deviceKey] || PREVIEW_DEVICES.iphone16pro;
        setInspectedSlotName(spec.name);

        // Строим информацию по всем слоям под курсором
        const summaries: LayerSummary[] = validElements.map((el, i) => {
          const { componentName, sourceFile, sourceLine } = getReactSourceInfo(el);
          const r = el.getBoundingClientRect();
          const cls = typeof el.className === 'string' ? el.className : (el.className as any)?.baseVal || '';
          const text = el.innerText?.trim()?.slice(0, 70) || '';
          const tag = el.tagName.toLowerCase();
          return {
            tag,
            className: cls,
            textSnippet: text,
            componentName,
            sourceFile,
            sourceLine,
            width: Math.round(r.width),
            height: Math.round(r.height),
            roleHint: i === 0 ? 'Верхний' : i === validElements.length - 1 ? 'Дно' : 'Под ним',
          };
        });

        setLayers(summaries);

        // Если при клике был зажат Alt — сразу выбираем слой под ним (глубже)
        const targetIdx = (e.altKey && validElements.length > 1) ? 1 : 0;
        selectElementFromStack(targetIdx, doc, validElements);
        setIsInspectMode(false);

        if (overlay) {
          overlay.style.display = 'none';
        }
      };

      doc.addEventListener('mousemove', handleMouseMove, true);
      doc.addEventListener('click', handleClick, true);

      cleanupFns.push(() => {
        if (doc) {
          doc.removeEventListener('mousemove', handleMouseMove, true);
          doc.removeEventListener('click', handleClick, true);
          const ov = doc.getElementById('__antigravity_hover_overlay__');
          if (ov) ov.remove();
          doc.body.style.cursor = 'default';
        }
      });
    });

    return () => {
      cleanupFns.forEach(fn => fn());
    };
  }, [isInspectMode, slots]);

  // Hotkey listener (Alt+I, 'i', Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isInspectMode) setIsInspectMode(false);
        if (selectedElement) handleDeselect();
        setShowQrModal(false);
        return;
      }

      const isAltI = e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш');
      const isBareI = !isInput && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш');

      if (isAltI || isBareI) {
        e.preventDefault();
        setIsInspectMode(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInspectMode, selectedElement]);

  // Open Tunnel & QR codes
  const handleOpenTunnel = async () => {
    setShowQrModal(true);
    if (!wifiQr) {
      QRCode.toDataURL(localWifiUrl, { margin: 2, width: 220 }).then(setWifiQr);
    }

    if (!tunnelUrl && !tunnelLoading) {
      setTunnelLoading(true);
      try {
        const res = await fetch('/api/tunnel', { method: 'POST' });
        const data = await res.json();
        if (data.url) {
          setTunnelUrl(data.url);
          QRCode.toDataURL(data.url, { margin: 2, width: 220 }).then(setTunnelQr);
        }
      } catch (e) {
        console.error('Failed to start tunnel:', e);
      } finally {
        setTunnelLoading(false);
      }
    }
  };

  // Slot Management
  const handleAddSlot = () => {
    if (slots.length >= 3) return;
    const presets = ['iphonese', 'pixel8', 's24ultra', 'ipadmini'];
    const nextPreset = presets[slots.length % presets.length];
    setSlots(prev => [
      ...prev,
      { id: `slot-${Date.now().toString(36)}`, deviceKey: nextPreset, rotated: false },
    ]);
  };

  const handleRotateSlot = (id: string) => {
    setSlots(prev =>
      prev.map(s => (s.id === id ? { ...s, rotated: !s.rotated } : s))
    );
  };

  const handleChangeSlotDevice = (id: string, newKey: string) => {
    setSlots(prev =>
      prev.map(s => (s.id === id ? { ...s, deviceKey: newKey } : s))
    );
  };

  const handleRemoveSlot = (id: string) => {
    if (slots.length <= 1) return;
    setSlots(prev => prev.filter(s => s.id !== id));
    iframesRef.current.delete(id);
  };

  const handleScreenshot = (slotId: string) => {
    const iframe = iframesRef.current.get(slotId);
    if (iframe) {
      alert('Скриншот экрана зафиксирован!');
    }
  };

  const handleCopyPrompt = () => {
    const primaryDevice = PREVIEW_DEVICES[slots[0]?.deviceKey] || PREVIEW_DEVICES.iphone16pro;
    const deviceName = inspectedSlotName || primaryDevice.name;
    let prompt = `Посмотри на экран в симуляторе (${deviceName}).\n`;

    if (selectedElement) {
      prompt += `\n🎯 ЭЛЕМЕНТ:\n`;
      if (selectedElement.sourceFile) {
        prompt += `• Файл: ${selectedElement.sourceFile}${selectedElement.sourceLine ? `:${selectedElement.sourceLine}` : ''}\n`;
      }
      if (selectedElement.componentName) {
        prompt += `• Компонент: <${selectedElement.componentName}>\n`;
      }
      if (selectedElement.layerIndex !== undefined && selectedElement.totalLayers && selectedElement.totalLayers > 1) {
        prompt += `• Слой: ${selectedElement.layerIndex + 1} из ${selectedElement.totalLayers}${
          selectedElement.layerIndex > 0 && selectedElement.coveringTag
            ? ` (под перекрывающим слоем <${selectedElement.coveringTag}>)`
            : ' (верхний слой)'
        }\n`;
      }
      prompt += `• Тег: <${selectedElement.tag}>\n`;
      if (selectedElement.className) {
        prompt += `• Классы: "${selectedElement.className}"\n`;
      }
      if (selectedElement.textSnippet) {
        prompt += `• Текст: "${selectedElement.textSnippet}"\n`;
      }
      prompt += `• Размер: ${selectedElement.rect.width} × ${selectedElement.rect.height} px\n`;
      prompt += `• Путь в DOM: ${selectedElement.selector}\n`;

      // Подобранные стили (если пользователь настраивал регуляторы)
      const overrides: string[] = [];
      if (tunerState.bgOpacity === 0) {
        overrides.push(`заливка: сделать фон полностью прозрачным (bg-transparent / background: transparent)`);
      } else if (tunerState.bgOpacity < 100) {
        overrides.push(`заливка: полупрозрачный фон ${tunerState.bgOpacity}%`);
      }

      if (tunerState.align === 'left') {
        overrides.push(`выравнивание: по левому краю (text-left / self-start)`);
      } else if (tunerState.align === 'center') {
        overrides.push(`выравнивание: по центру (text-center / self-center / mx-auto)`);
      } else if (tunerState.align === 'right') {
        overrides.push(`выравнивание: по правому краю (text-right / self-end)`);
      }

      if (tunerState.heightUnit !== 'auto' && tunerState.heightVal > 0) {
        overrides.push(`высота: ${tunerState.heightVal}${tunerState.heightUnit} (h-[${tunerState.heightVal}${tunerState.heightUnit}])`);
      }
      if (tunerState.widthUnit !== 'auto' && tunerState.widthVal > 0) {
        overrides.push(`ширина: ${tunerState.widthVal}${tunerState.widthUnit} (w-[${tunerState.widthVal}${tunerState.widthUnit}])`);
      }
      if (tunerState.radiusVal > 0) {
        overrides.push(`скругление: ${tunerState.radiusVal}px (rounded-[${tunerState.radiusVal}px])`);
      }

      if (overrides.length > 0) {
        prompt += `\n🎨 ПОДОБРАННЫЕ НАСТРОЙКИ (ПРИМЕНИТЬ В КОДЕ):\n${overrides.map(o => `• ${o}`).join('\n')}\n`;
      }
    }

    prompt += `\nЧТО НУЖНО СДЕЛАТЬ:\n${noteText.trim() ? noteText.trim() : 'Проверь стили и поведение этого элемента.'}`;

    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div
      className={`min-h-screen flex flex-col p-3 sm:p-5 font-sans select-none transition-colors duration-200 ${currentBg.bg} ${currentBg.text}`}
    >
      {/* TOP FLOATING TOOLBAR */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 mb-3 px-2">
        {/* LEFT TOOLBAR: WORKSPACE CONTROLS */}
        <div className="flex items-center gap-2">
          {/* Add Screen Button (Mobile View style) */}
          <button
            onClick={handleAddSlot}
            disabled={slots.length >= 3}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
              slots.length >= 3
                ? 'opacity-40 cursor-not-allowed'
                : isDark
                ? 'bg-[#13121F] border-white/10 text-zinc-200 hover:text-white hover:border-[#B833FF]'
                : 'bg-white border-zinc-300 text-zinc-800 hover:text-black hover:border-[#B833FF]'
            }`}
            title="Добавить еще один экран для параллельного сравнения (до 3 экранов)"
          >
            <span className="text-[#B833FF] font-black">+</span>
            <span>Экран ({slots.length}/3)</span>
          </button>

          {/* Bezel Toggle (Frameless vs Realistic Bezel) */}
          <button
            onClick={() => setShowBezel(b => !b)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
              !showBezel
                ? 'bg-[#B833FF] text-white border-[#B833FF]'
                : isDark
                ? 'bg-[#13121F] border-white/10 text-zinc-200 hover:text-white hover:border-[#B833FF]'
                : 'bg-white border-zinc-300 text-zinc-800 hover:border-[#B833FF]'
            }`}
            title="Переключить режим: с рамкой смартфона или чистый безрамочный viewport"
          >
            <span>{showBezel ? '📱 Рамка' : '🔲 Без рамки'}</span>
          </button>

          {/* Mobile Tunnel QR Button */}
          <button
            onClick={handleOpenTunnel}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
              isDark
                ? 'bg-[#13121F] border-white/10 text-zinc-200 hover:text-white hover:border-[#B833FF]'
                : 'bg-white border-zinc-300 text-zinc-800 hover:text-black hover:border-[#B833FF]'
            }`}
            title="Открыть на реальном смартфоне через QR-код"
          >
            <span>📲</span>
            <span>На телефон</span>
            {tunnelUrl && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
            )}
          </button>
        </div>

        {/* RIGHT TOOLBAR: THEME TOGGLE, REFRESH, ZOOM */}
        <div className="flex items-center gap-2">
          {/* Переключение ночного и светлого режима одной иконкой (солнце-луна) */}
          <button
            onClick={() => setBgKey(prev => (prev === 'white' ? 'cyber' : 'white'))}
            title={isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
            aria-label="Переключить тему"
            className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer shadow-sm ${
              isDark
                ? 'bg-[#13121F] border-white/10 text-amber-300 hover:text-white hover:border-[#B833FF]'
                : 'bg-white border-zinc-300 text-purple-600 hover:text-black hover:border-[#B833FF]'
            }`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Refresh Frame Button */}
          <button
            onClick={() => {
              iframesRef.current.forEach(iframe => {
                try {
                  iframe.src = iframe.src;
                } catch {}
              });
            }}
            title="Обновить все экраны"
            className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer shadow-sm ${
              isDark
                ? 'bg-[#13121F] border-white/10 text-zinc-300 hover:text-white hover:border-[#B833FF]'
                : 'bg-white border-zinc-300 text-zinc-700 hover:text-black hover:border-[#B833FF]'
            }`}
          >
            🔄
          </button>

          {/* Vertical Zoom Popover */}
          <div className="relative" ref={zoomSliderRef}>
            <button
              onClick={() => setShowZoomSlider(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
                showZoomSlider
                  ? 'bg-[#B833FF] text-white border-[#B833FF]'
                  : isDark
                  ? 'bg-[#13121F] border-white/10 text-zinc-200 hover:border-[#B833FF]'
                  : 'bg-white border-zinc-300 text-zinc-800 hover:border-[#B833FF]'
              }`}
              title="Нажмите, чтобы настроить масштаб от 20% до 200%"
            >
              <span>{Math.round(zoom * 100)}%</span>
              <span className="text-[10px] opacity-70">▾</span>
            </button>

            {showZoomSlider && (
              <div
                className={`absolute right-0 top-full mt-2 p-4 rounded-2xl border shadow-2xl z-50 flex flex-col items-center gap-3 w-20 transition-all ${
                  isDark ? 'bg-[#181729] border-white/15' : 'bg-white border-zinc-300 shadow-zinc-400/40'
                }`}
              >
                <span className="text-[11px] font-mono font-bold text-[#B833FF]">200%</span>

                <div className="h-44 flex items-center justify-center py-2">
                  <input
                    type="range"
                    min="20"
                    max="200"
                    step="5"
                    value={Math.round(zoom * 100)}
                    onChange={e => setZoom(Number(e.target.value) / 100)}
                    className="accent-[#B833FF] cursor-pointer"
                    style={{
                      writingMode: 'vertical-lr',
                      direction: 'rtl',
                      height: '140px',
                      width: '24px',
                    }}
                  />
                </div>

                <span className="text-[11px] font-mono font-bold opacity-60">20%</span>

                <button
                  onClick={() => setZoom(1)}
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer ${
                    zoom === 1
                      ? 'bg-[#B833FF] text-white'
                      : isDark
                      ? 'bg-white/10 text-zinc-300 hover:bg-white/20'
                      : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                  }`}
                >
                  100%
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* TARGET URL ADDRESS BAR & PRESETS */}
      <div className={`mb-4 px-3 py-2 rounded-2xl border flex flex-wrap items-center justify-between gap-3 shadow-md transition-colors ${
        isDark ? 'bg-[#13121F] border-white/10' : 'bg-white border-zinc-200'
      }`}>
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <span className="text-xs font-bold text-zinc-400 pl-1 shrink-0">🌐 URL цели:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTargetUrl(inputUrl);
            }}
            className="flex items-center gap-1.5 flex-1"
          >
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Введите URL (например: /demo или http://localhost:3000)..."
              className={`flex-1 px-3 py-1.5 rounded-xl border text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-[#B833FF] transition-all ${
                isDark ? 'bg-black/50 border-white/10 text-white placeholder:text-zinc-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 placeholder:text-zinc-400'
              }`}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-xl bg-[#B833FF] hover:bg-[#A822F0] text-white text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
            >
              Перейти
            </button>
          </form>
        </div>

        {/* Quick URL presets */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Пресеты:</span>
          {[
            { label: '⚡ Демо (/demo)', url: '/demo' },
            { label: ':3000', url: 'http://localhost:3000' },
            { label: ':3050', url: 'http://localhost:3050' },
          ].map((p) => (
            <button
              key={p.url}
              type="button"
              onClick={() => {
                setInputUrl(p.url);
                setTargetUrl(p.url);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
                targetUrl === p.url
                  ? 'bg-[#B833FF]/20 border-[#B833FF] text-[#D8B4FE]'
                  : isDark
                  ? 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                  : 'bg-zinc-100 border-zinc-200 text-zinc-750 hover:bg-zinc-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* WORKSPACE: INSPECTOR PANEL (LEFT) + MULTI-SCREEN PHONES (RIGHT) */}
      <div className="flex-1 flex flex-row gap-6 items-start justify-center overflow-x-auto p-1">
        {/* COMPACT & STICKY PANEL (LEFT SIDE) */}
        <div
          className={`w-[290px] sm:w-[320px] shrink-0 rounded-3xl p-4 shadow-xl flex flex-col gap-3 border transition-colors sticky top-4 ${
            isDark ? 'bg-[#13121F] border-white/10' : 'bg-white border-zinc-200 shadow-zinc-200/50'
          }`}
        >
          {/* HEADER ROW: TITLE + INSPECT POINTER BUTTON (Model select removed as requested) */}
          <div className={`flex items-center justify-between gap-2 pb-3 border-b ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
            <div className="flex items-center gap-2">
              <span className="text-base">🔍</span>
              <span className={`text-xs font-black tracking-tight ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                Инспектор правок
              </span>
            </div>

            {/* Inspect Toggle Button - Mouse pointer icon */}
            <button
              onClick={() => setIsInspectMode(!isInspectMode)}
              className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                isInspectMode
                  ? 'bg-[#B833FF] text-white border-[#B833FF] ring-2 ring-[#B833FF]/50 shadow-[0_0_14px_rgba(184,51,255,0.6)] animate-pulse'
                  : isDark
                  ? 'bg-[#1C1A2E] border-white/10 text-zinc-300 hover:text-white hover:border-[#B833FF]'
                  : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:text-black hover:border-[#B833FF]'
              }`}
              title="Выбрать элемент (Alt + I или I)"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                <path d="m13 13 6 6" />
              </svg>
            </button>
          </div>

          {/* INSPECTED ELEMENT CARD (ONLY IF SELECTED) */}
          {selectedElement && (
            <div
              className={`border rounded-2xl p-3 space-y-2 transition-all ${
                isDark
                  ? 'bg-[#1C1A2E] border-[#B833FF]/40 shadow-[0_4px_16px_rgba(184,51,255,0.15)]'
                  : 'bg-purple-50/60 border-purple-200 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] animate-ping shrink-0" />
                  <span className={`text-xs font-black font-mono truncate ${isDark ? 'text-[#E9D5FF]' : 'text-purple-700'}`}>
                    &lt;{selectedElement.tag}&gt;
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                    {selectedElement.rect.width} × {selectedElement.rect.height}px
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSelectParent}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer ${
                      isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'
                    }`}
                    title="Выбрать родительский элемент (DOM Parent)"
                  >
                    ⬆ Род.
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectChild}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer ${
                      isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'
                    }`}
                    title="Выбрать первый дочерний элемент (DOM Child)"
                  >
                    ⬇ Доч.
                  </button>
                  <button
                    onClick={handleDeselect}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs px-1.5 py-0.5 rounded cursor-pointer"
                    title="Снять выбор (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* СЛОИ ПОД КУРСОРОМ / ВЫБОР ЭЛЕМЕНТА ПОД НИМ */}
              {layers.length > 1 && (
                <div
                  className={`p-2.5 rounded-2xl border space-y-2 ${
                    isDark ? 'bg-black/40 border-[#B833FF]/30' : 'bg-purple-50/70 border-purple-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs">🥞</span>
                      <span className={`text-[11px] font-black ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                        Слои в точке ({layers.length}):
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={activeLayerIndex <= 0}
                        onClick={() => selectElementFromStack(activeLayerIndex - 1)}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/5 border-white/10 hover:bg-white/15 text-white cursor-pointer"
                        title="Выбрать верхний слой"
                      >
                        ⬆ Выше
                      </button>
                      <button
                        type="button"
                        disabled={activeLayerIndex >= layers.length - 1}
                        onClick={() => selectElementFromStack(activeLayerIndex + 1)}
                        className="px-2.5 py-0.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-[#8E2DE2] to-[#B833FF] text-white hover:opacity-90 shadow-sm cursor-pointer flex items-center gap-1"
                        title="Выбрать элемент под ним (следующий слой вглубь)"
                      >
                        <span>⬇ Под ним</span>
                        <span className="text-[9px] opacity-80">({activeLayerIndex + 2}/{layers.length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Список слоёв в точке */}
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-0.5">
                    {layers.map((layer, idx) => {
                      const isSelected = idx === activeLayerIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectElementFromStack(idx)}
                          className={`w-full text-left px-2 py-1.5 rounded-xl text-[10.5px] font-mono flex items-center justify-between gap-1.5 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#B833FF] text-white font-black shadow-[0_2px_8px_rgba(184,51,255,0.4)]'
                              : isDark
                              ? 'bg-[#151424] hover:bg-white/10 border border-white/5 text-zinc-300 hover:text-white'
                              : 'bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-800'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate min-w-0">
                            <span className={`text-[8.5px] px-1.5 py-0.2 rounded font-black shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-black/30 text-zinc-400'}`}>
                              #{idx + 1}
                            </span>
                            <span className="font-bold truncate shrink-0">
                              &lt;{layer.tag}&gt;
                            </span>
                            {layer.componentName && (
                              <span className={`text-[9.5px] truncate font-sans font-bold px-1 rounded shrink-0 ${isSelected ? 'bg-black/25 text-[#E9D5FF]' : 'text-emerald-400 bg-emerald-500/10'}`}>
                                {layer.componentName}
                              </span>
                            )}
                            <span className={`truncate text-[9.5px] font-sans ${isSelected ? 'text-white/80' : 'text-zinc-500'}`}>
                              {layer.textSnippet ? `"${layer.textSnippet}"` : layer.className ? `.${layer.className.split(' ')[0]}` : ''}
                            </span>
                          </div>
                          <span className={`text-[9px] shrink-0 font-sans font-bold ${isSelected ? 'text-white/90' : 'text-zinc-500'}`}>
                            {idx === 0 ? 'Верхний' : idx === layers.length - 1 ? 'Дно' : 'Под ним'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Управление перекрывающим слоем: скрыть или вернуть */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[9.5px]">
                    <button
                      type="button"
                      onClick={handleToggleHideCurrentElement}
                      className="px-2 py-1 rounded-lg font-bold border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                      title="Временно скрыть текущий элемент, чтобы разблокировать доступ к элементам под ним"
                    >
                      <span>👁️ Скрыть этот слой</span>
                    </button>

                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={handleRestoreHiddenElements}
                        className="px-2 py-1 rounded-lg font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                        title="Восстановить все временно скрытые слои"
                      >
                        <span>↩️ Вернуть скрытые ({hiddenCount})</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {hiddenCount > 0 && layers.length <= 1 && (
                <div className="flex items-center justify-between p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
                  <span>Скрыто слоев: {hiddenCount}</span>
                  <button
                    type="button"
                    onClick={handleRestoreHiddenElements}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-bold cursor-pointer"
                  >
                    ↩️ Вернуть все
                  </button>
                </div>
              )}

              {/* React Component & Source File Location Badge */}
              {selectedElement.sourceFile && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded-xl border font-mono flex items-center justify-between gap-1.5 ${
                    isDark
                      ? 'text-emerald-300 bg-emerald-950/40 border-emerald-500/40'
                      : 'text-emerald-800 bg-emerald-50 border-emerald-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="shrink-0">📁</span>
                    <span className="font-bold truncate">
                      {selectedElement.sourceFile}{selectedElement.sourceLine ? `:${selectedElement.sourceLine}` : ''}
                    </span>
                  </div>
                  {selectedElement.componentName && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-black bg-emerald-500/20 text-emerald-400">
                      &lt;{selectedElement.componentName}&gt;
                    </span>
                  )}
                </div>
              )}

              {selectedElement.textSnippet && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded-xl border font-mono line-clamp-2 ${
                    isDark ? 'text-zinc-300 bg-black/40 border-white/5' : 'text-zinc-700 bg-white border-zinc-200'
                  }`}
                >
                  <span className="opacity-50">Текст: </span>&quot;{selectedElement.textSnippet}&quot;
                </div>
              )}

              {selectedElement.className && (
                <div
                  className={`text-[10px] px-2.5 py-1.5 rounded-xl border font-mono line-clamp-2 break-all ${
                    isDark ? 'text-zinc-400 bg-black/40 border-white/5' : 'text-zinc-600 bg-white border-zinc-200'
                  }`}
                >
                  <span className="opacity-50">Классы: </span>{selectedElement.className}
                </div>
              )}

              {/* 🎛️ СВОЙСТВА ЭЛЕМЕНТА (ТОЛЬКО ЧИСЛОВОЙ ВВОД, БЕЗ ПОЛЗУНКОВ И ПРЕСЕТОВ) */}
              <div
                className={`p-3 rounded-2xl border space-y-3 ${
                  isDark ? 'bg-black/35 border-white/10' : 'bg-purple-50/50 border-purple-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-extrabold text-[11px]">
                    <span className="text-xs">🎛️</span>
                    <span className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>Свойства элемента</span>
                  </div>
                  <span className="text-[9px] font-mono text-[#D8B4FE] bg-[#B833FF]/20 px-1.5 py-0.5 rounded-full font-bold">
                    Live
                  </span>
                </div>

                {/* 1. ПРОЗРАЧНОСТЬ ФОНА (ТОЛЬКО ЗАЛИВКА, НЕ ЗАТРАГИВАЕТ ТЕКСТ И ИКОНКИ) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-zinc-400">Прозрачность фона (заливки):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={tunerState.bgOpacity}
                        onChange={(e) => {
                          const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
                          applyTunerStyle({ bgOpacity: v });
                        }}
                        className={`w-14 px-2 py-1 text-right font-mono text-xs rounded-lg border font-bold focus:outline-none focus:ring-1 focus:ring-[#B833FF] ${
                          isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <span className="text-xs font-mono font-bold text-[#D8B4FE]">%</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyTunerStyle({ bgOpacity: 0 })}
                    className={`w-full py-1.5 px-3 rounded-xl border text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      tunerState.bgOpacity === 0
                        ? 'bg-[#B833FF] text-white border-[#B833FF] shadow-sm font-black'
                        : isDark
                        ? 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
                        : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <span>🚫</span>
                    <span>Сделать фон прозрачным (0%)</span>
                  </button>
                </div>

                {/* 2. ВЫРАВНИВАНИЕ (ВЛЕВО / ПО ЦЕНТРУ / ВПРАВО) */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-zinc-400">Выравнивание:</span>
                    <span className="font-mono text-[9px] text-[#D8B4FE] font-bold">
                      {tunerState.align === 'left' ? 'влево' : tunerState.align === 'center' ? 'по центру' : tunerState.align === 'right' ? 'вправо' : 'по умолчанию'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyTunerStyle({ align: tunerState.align === 'left' ? 'none' : 'left' })}
                      className={`py-1.5 px-2 rounded-xl border text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        tunerState.align === 'left'
                          ? 'bg-[#B833FF] text-white border-[#B833FF] shadow-sm font-black'
                          : isDark
                          ? 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                      }`}
                      title="Выровнять по левому краю"
                    >
                      <span>⬅</span>
                      <span>Влево</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTunerStyle({ align: tunerState.align === 'center' ? 'none' : 'center' })}
                      className={`py-1.5 px-2 rounded-xl border text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        tunerState.align === 'center'
                          ? 'bg-[#B833FF] text-white border-[#B833FF] shadow-sm font-black'
                          : isDark
                          ? 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                      }`}
                      title="Выровнять по центру"
                    >
                      <span>↔</span>
                      <span>Центр</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTunerStyle({ align: tunerState.align === 'right' ? 'none' : 'right' })}
                      className={`py-1.5 px-2 rounded-xl border text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        tunerState.align === 'right'
                          ? 'bg-[#B833FF] text-white border-[#B833FF] shadow-sm font-black'
                          : isDark
                          ? 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                      }`}
                      title="Выровнять по правому краю"
                    >
                      <span>➡</span>
                      <span>Вправо</span>
                    </button>
                  </div>
                </div>

                {/* 3. ВЫСОТА (ТОЛЬКО ЧИСЛОВОЙ ВВОД + ЕДИНИЦЫ) */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-zinc-400">Высота:</span>
                    <div className="flex items-center gap-0.5">
                      {(['px', '%', 'dvh', 'auto'] as const).map(u => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            if (u === 'auto') applyTunerStyle({ heightUnit: 'auto' });
                            else if (u === '%') applyTunerStyle({ heightUnit: '%', heightVal: tunerState.heightUnit === '%' ? tunerState.heightVal : 50 });
                            else if (u === 'dvh') applyTunerStyle({ heightUnit: 'dvh', heightVal: tunerState.heightUnit === 'dvh' ? tunerState.heightVal : 50 });
                            else applyTunerStyle({ heightUnit: 'px', heightVal: tunerState.heightUnit === 'px' ? tunerState.heightVal : selectedElement.rect.height });
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold transition-all cursor-pointer ${
                            tunerState.heightUnit === u
                              ? 'bg-[#B833FF] text-white font-black'
                              : 'bg-white/10 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                  {tunerState.heightUnit !== 'auto' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={tunerState.heightVal}
                        onChange={(e) => applyTunerStyle({ heightVal: parseInt(e.target.value, 10) || 0 })}
                        className={`w-full px-2.5 py-1 text-right font-mono text-xs rounded-lg border font-bold focus:outline-none focus:ring-1 focus:ring-[#B833FF] ${
                          isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <span className="text-xs font-mono font-bold text-[#D8B4FE] shrink-0 w-8">{tunerState.heightUnit}</span>
                    </div>
                  )}
                </div>

                {/* 4. ШИРИНА (ТОЛЬКО ЧИСЛОВОЙ ВВОД + ЕДИНИЦЫ) */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-zinc-400">Ширина:</span>
                    <div className="flex items-center gap-0.5">
                      {(['px', '%', 'auto'] as const).map(u => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            if (u === 'auto') applyTunerStyle({ widthUnit: 'auto' });
                            else if (u === '%') applyTunerStyle({ widthUnit: '%', widthVal: tunerState.widthUnit === '%' ? tunerState.widthVal : 100 });
                            else applyTunerStyle({ widthUnit: 'px', widthVal: tunerState.widthUnit === 'px' ? tunerState.widthVal : selectedElement.rect.width });
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold transition-all cursor-pointer ${
                            tunerState.widthUnit === u
                              ? 'bg-[#B833FF] text-white font-black'
                              : 'bg-white/10 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                  {tunerState.widthUnit !== 'auto' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={tunerState.widthVal}
                        onChange={(e) => applyTunerStyle({ widthVal: parseInt(e.target.value, 10) || 0 })}
                        className={`w-full px-2.5 py-1 text-right font-mono text-xs rounded-lg border font-bold focus:outline-none focus:ring-1 focus:ring-[#B833FF] ${
                          isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <span className="text-xs font-mono font-bold text-[#D8B4FE] shrink-0 w-8">{tunerState.widthUnit}</span>
                    </div>
                  )}
                </div>

                {/* 5. СКРУГЛЕНИЕ УГЛОВ (ТОЛЬКО ЧИСЛОВОЙ ВВОД В PX) */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-zinc-400">Скругление углов:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={tunerState.radiusVal}
                        onChange={(e) => applyTunerStyle({ radiusVal: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                        className={`w-14 px-2 py-1 text-right font-mono text-xs rounded-lg border font-bold focus:outline-none focus:ring-1 focus:ring-[#B833FF] ${
                          isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <span className="text-xs font-mono font-bold text-[#D8B4FE]">px</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Live Tailwind Override (Edit classes live in simulator) */}
              <div className="pt-1 border-t border-white/10 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-400">⚡ ЖИВОЙ СТИЛЬ:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleApplyLiveStyle((liveClasses + ' bg-transparent').trim())}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#B833FF]/20 text-[#D8B4FE] hover:bg-[#B833FF]/30 transition-colors cursor-pointer"
                    >
                      +bg-none
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyLiveStyle((liveClasses + ' rounded-2xl').trim())}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/10 text-zinc-300 hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      +rounded
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={liveClasses}
                  onChange={(e) => handleApplyLiveStyle(e.target.value)}
                  placeholder="Добавь или измени Tailwind классы..."
                  className={`w-full px-2.5 py-1.5 text-[10.5px] font-mono rounded-xl border focus:outline-none transition-colors ${
                    isDark
                      ? 'bg-black/50 border-white/10 text-white focus:border-[#B833FF]'
                      : 'bg-white border-zinc-200 text-slate-900 focus:border-[#B833FF]'
                  }`}
                />
              </div>
            </div>
          )}

          {/* NOTE INPUT */}
          <div className="space-y-1">
            <label
              className={`text-[10px] font-bold uppercase tracking-wider ${
                isDark ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              Что нужно изменить:
            </label>
            <textarea
              rows={4}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Опишите, что изменить..."
              className={`w-full border rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#B833FF] resize-none font-sans transition-colors ${
                isDark
                  ? 'bg-[#0D0C15] border-white/10 text-zinc-200 placeholder:text-zinc-600'
                  : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
              }`}
            />
          </div>

          {/* COPY PROMPT BUTTON */}
          <button
            onClick={handleCopyPrompt}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#8E2DE2] to-[#B833FF] hover:opacity-95 text-white text-xs font-black uppercase tracking-wider shadow-[0_8px_20px_rgba(184,51,255,0.4)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
          >
            <span>📋 Скопировать</span>
          </button>

          {copied && (
            <div className="text-center text-xs font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 py-1.5 rounded-xl">
              ✓ Скопировано! Вставьте в чат (Ctrl + V)
            </div>
          )}
        </div>

        {/* PHONES ROW: RENDER ALL ACTIVE SLOTS SIDE-BY-SIDE */}
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          className="flex flex-row gap-8 items-start justify-center transition-transform duration-150 shrink-0"
        >
          {slots.map((slot) => {
            const spec = PREVIEW_DEVICES[slot.deviceKey] || PREVIEW_DEVICES.iphone16pro;
            return (
              <PhoneSlot
                key={slot.id}
                id={slot.id}
                device={spec}
                rotated={slot.rotated}
                showBezel={showBezel}
                canRemove={slots.length > 1}
                hapticTriggered={hapticTriggered}
                allDevices={PREVIEW_DEVICES}
                iframeRef={(el) => {
                  if (el) iframesRef.current.set(slot.id, el);
                  else iframesRef.current.delete(slot.id);
                }}
                onRotate={() => handleRotateSlot(slot.id)}
                onChangeDevice={(newKey) => handleChangeSlotDevice(slot.id, newKey)}
                onRemove={() => handleRemoveSlot(slot.id)}
                onScreenshot={() => handleScreenshot(slot.id)}
                isDark={isDark}
                iframeSrc={targetUrl}
              />
            );
          })}
        </div>
      </div>

      {/* MODAL 1: QR CODE & MOBILE TUNNEL */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-3xl p-6 border shadow-2xl space-y-4 ${
              isDark ? 'bg-[#151424] border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xl">📲</span>
                <h3 className="font-extrabold text-sm">Тестирование на реальном смартфоне</h3>
              </div>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-zinc-400 hover:text-white text-base px-2 py-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Отсканируйте QR-код камерой iPhone или Android, чтобы открыть приложение прямо в мобильном Safari/Chrome или Telegram с живым Hot Reload:
            </p>

            {/* QR CODE CARDS (WI-FI PRIMARY + TELEGRAM HTTPS) */}
            <div className="grid grid-cols-2 gap-3 text-center">
              {/* Local Wi-Fi (Primary - 100% Reliable without Cloudflare Error 1033) */}
              <div className="p-3 rounded-2xl bg-black/40 border border-[#B833FF]/30 flex flex-col items-center gap-2 relative">
                <span className="absolute -top-2.5 bg-[#B833FF] text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Рекомендуется
                </span>
                <span className="text-[11px] font-bold text-white flex items-center gap-1 mt-1">
                  <span>📶 Локальный Wi-Fi</span>
                </span>
                {wifiQr ? (
                  <img src={wifiQr} alt="WiFi QR" className="w-36 h-36 rounded-xl bg-white p-1.5 shadow-md" />
                ) : (
                  <div className="w-36 h-36 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center text-zinc-400 text-xs">
                    Генерация...
                  </div>
                )}
                <span className="text-[10px] text-zinc-300 font-mono font-bold">
                  {localWifiUrl}
                </span>
                <span className="text-[9px] text-zinc-500">
                  Safari / Chrome на iPhone (в одной сети)
                </span>
              </div>

              {/* Public HTTPS (Production or Localtunnel) */}
              <div className="p-3 rounded-2xl bg-black/30 border border-white/10 flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-[#E9D5FF] flex items-center gap-1">
                  <span>🌐 Telegram HTTPS</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                </span>
                {tunnelQr ? (
                  <img src={tunnelQr} alt="Tunnel QR" className="w-36 h-36 rounded-xl bg-white p-1.5 shadow-md" />
                ) : tunnelLoading ? (
                  <div className="w-36 h-36 rounded-xl bg-black/40 border border-white/5 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                    <span className="w-5 h-5 border-2 border-[#B833FF] border-t-transparent rounded-full animate-spin" />
                    <span>Подключение...</span>
                  </div>
                ) : (
                  <div className="w-36 h-36 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center text-zinc-400 text-xs">
                    Ожидание...
                  </div>
                )}
                <span className="text-[9px] text-zinc-400 font-mono truncate max-w-[140px]">
                  {tunnelUrl || 'https://kitty.wowpn.com'}
                </span>
                <span className="text-[9px] text-zinc-500">
                  Для официального клиента Telegram
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(localWifiUrl);
                  alert('Wi-Fi адрес скопирован: ' + localWifiUrl);
                }}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-colors cursor-pointer"
              >
                📋 Копировать Wi-Fi
              </button>
              {tunnelUrl && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(tunnelUrl);
                    alert('HTTPS адрес скопирован: ' + tunnelUrl);
                  }}
                  className="flex-1 py-2 rounded-xl bg-[#B833FF]/20 hover:bg-[#B833FF]/30 border border-[#B833FF]/40 text-xs font-bold text-[#E9D5FF] transition-colors cursor-pointer"
                >
                  📋 Копировать HTTPS
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
