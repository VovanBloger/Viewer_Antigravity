'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Crosshair,
  Plus,
  Smartphone,
  RefreshCw,
  Maximize2,
  Copy,
  Check,
  Undo2,
  Redo2,
  Layers,
  ArrowUp,
  ArrowDown,
  EyeOff,
  Eye,
  Command,
  Ruler,
  Wifi,
  FileCode,
  PanelLeft,
  PanelRight,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  ShieldCheck,
  ListTodo,
  Code2,
  Settings,
} from 'lucide-react';
import {
  PREVIEW_DEVICES,
  WORKSPACE_PRESETS,
  ANTIGRAVITY_THEMES,
  DEFAULT_HOTKEYS,
  AntigravityTheme,
  HotkeyBinding,
} from '@/lib/preview-devices';
import {
  hapticAudioEngine,
  ImpactStyle,
  HapticEventRecord,
} from '@/lib/haptics';
import {
  StyleTunerState,
  DEFAULT_TUNER_STATE,
  LayerSummary,
  ElementInfo,
  AgentQueueItem,
  LayoutAuditIssue,
  SMART_AGENT_DIRECTIVES,
  computeStyleDiff,
  buildConsolidatedAgentPrompt,
  buildIdeDeepLink,
  calculateFitZoom,
} from '@/lib/antigravity-core';
import {
  getReactSourceInfo,
  getBoxModelMetrics,
  buildDomSelectorPath,
  updateSelectedOverlay,
  clearSelectedOverlay,
  scanIframeForAuditIssues,
} from '@/lib/dom-inspector';
import { PhoneSlot } from '@/components/preview/PhoneSlot';
import { AgentQueueView } from '@/components/workbench/AgentQueueView';
import { LayoutAuditView } from '@/components/workbench/LayoutAuditView';
import { HotkeysThemeView } from '@/components/workbench/HotkeysThemeView';
import { CodeBlueprintView } from '@/components/workbench/CodeBlueprintView';
import { LayerBuilderDock } from '@/components/workbench/LayerBuilderDock';
import { CommandPaletteModal, MobileTunnelModal } from '@/components/workbench/CommandPaletteModal';
import { TechnicalScreenshotModal } from '@/components/workbench/TechnicalScreenshotModal';
import { TgSimulatedEnv } from '@/components/demo/DemoApp';
import {
  DesignLayerNode,
  DesignLayerTransform,
  BuilderOperationRecord,
  formatLayerBuilderDiff,
} from '@/lib/layer-builder';
import {
  extractIframeDesignLayers,
  ensureLayerAttributes,
  findDomElementByLayerId,
  restoreAllDomHiddenLayers,
  countDomHiddenLayers,
  applyLayerTransformToDom,
  updateDomLayerText,
  updateDomLayerTextColor,
  updateDomLayerBgColor,
  updateDomLayerIcon,
  renderScreenSurfaceCanvas,
  sampleScreenColorAtPoint,
  swapDomLayerOrder,
  groupDomLayers,
  ungroupDomLayer,
  duplicateDomLayer,
  toggleDomLayerVisibility,
  toggleDomLayerLock,
  resetAllDomLayerTransforms,
  syncBuilderGizmoInIframe,
} from '@/lib/dom-layer-engine';
import {
  captureVisualTechnicalScreenshot,
  VisualTechnicalScreenshotResult,
} from '@/lib/screenshot-engine';

interface DeviceSlotState {
  id: string;
  deviceKey: string;
  rotated: boolean;
}

export type DockTab = 'layers' | 'queue' | 'audit' | 'code' | 'settings';
type ActiveSection = 'canvas' | 'queue' | 'audit' | 'settings' | 'code';

export default function ViewerAntigravityWorkbench() {
  // Active Workbench Dock Tab (Canvas stays permanently open, dock switches views)
  const [dockTab, setDockTab] = useState<DockTab>('layers');
  const activeSection: ActiveSection = dockTab === 'layers' ? 'canvas' : dockTab;
  const setActiveSection = useCallback((s: string) => {
    if (s === 'canvas') setDockTab('layers');
    else if (s === 'queue' || s === 'audit' || s === 'code' || s === 'settings') {
      setDockTab(s as DockTab);
    }
  }, []);

  // Theme & Hotkeys State
  const [themeKey, setThemeKey] = useState<AntigravityTheme['key']>('obsidian');
  const [hotkeys, setHotkeys] = useState<HotkeyBinding[]>(DEFAULT_HOTKEYS);

  const currentTheme = ANTIGRAVITY_THEMES[themeKey] || ANTIGRAVITY_THEMES.obsidian;
  const isDark = currentTheme.isDark;

  // Sync html.dark class for Tailwind v4 @custom-variant dark
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDark);
    }
  }, [isDark]);

  // Multi-Device Workspace State
  const [slots, setSlots] = useState<DeviceSlotState[]>([
    { id: 'slot-1', deviceKey: 'iphone16pro', rotated: false },
  ]);
  const [showBezel, setShowBezel] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showBoxModel, setShowBoxModel] = useState(true);
  const [zoom, setZoom] = useState(0.88);
  const [targetUrl, setTargetUrl] = useState('/demo');
  const [inputUrl, setInputUrl] = useState('/demo');

  // Inspector & Style Tuner State
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
  const [initialClasses, setInitialClasses] = useState('');
  const [liveClasses, setLiveClasses] = useState('');
  const [initialTuner, setInitialTuner] = useState<StyleTunerState>(DEFAULT_TUNER_STATE);
  const [tunerState, setTunerState] = useState<StyleTunerState>(DEFAULT_TUNER_STATE);
  const [undoStack, setUndoStack] = useState<StyleTunerState[]>([]);
  const [redoStack, setRedoStack] = useState<StyleTunerState[]>([]);

  // Z-Index Layers under cursor
  const [layers, setLayers] = useState<LayerSummary[]>([]);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [inspectedSlotName, setInspectedSlotName] = useState('iPhone 16 Pro');

  // Agent Directives & Prompt Queue State
  const [selectedDirectiveId, setSelectedDirectiveId] = useState<string>('responsive-320');
  const [noteText, setNoteText] = useState('');
  const [copiedSingle, setCopiedSingle] = useState(false);
  const [enqueuedFeedback, setEnqueuedFeedback] = useState(false);
  const [agentQueue, setAgentQueue] = useState<AgentQueueItem[]>([
    {
      id: 'seed-task-1',
      pinNumber: 1,
      createdAt: '18:00:00',
      slotDeviceName: 'iPhone 16 Pro',
      priority: 'high',
      directiveId: 'responsive-320',
      note: 'Сделать фон карточки прозрачным и выровнять заголовок по центру на экранах 320px',
      element: {
        tag: 'div',
        className: 'relative p-4 rounded-3xl bg-gradient-to-br from-[#3B1D7A] via-[#241445] to-[#131122]',
        textSnippet: 'Инспектор Z-Index и Тюнер 2.0',
        rect: { top: 148, left: 16, width: 361, height: 184 },
        selector: 'main > div > div.relative',
        componentName: 'HeroBannerCard',
        sourceFile: 'components/demo/DemoApp.tsx',
        sourceLine: 189,
        layerIndex: 0,
        totalLayers: 2,
      },
      diffs: [
        {
          property: 'Прозрачность фона',
          before: '100%',
          after: '0%',
          tailwindSuggestion: 'bg-transparent',
        },
      ],
    },
  ]);

  // Layout Audit & Telegram Env Simulation State
  const [auditIssues, setAuditIssues] = useState<LayoutAuditIssue[]>([]);
  const [tgEnv, setTgEnv] = useState<TgSimulatedEnv>({
    colorScheme: 'dark',
    safeAreaPad: true,
    mainButtonVisible: false,
    mainButtonText: 'Опубликовать в Telegram',
    stressOverflowBanner: false,
  });
  const [hapticTriggered, setHapticTriggered] = useState(false);
  const [hapticLogs, setHapticLogs] = useState<HapticEventRecord[]>([]);

  // Modals & Bridge Info
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTunnelModal, setShowTunnelModal] = useState(false);
  const [lanInfo, setLanInfo] = useState({
    localWifiUrl: 'http://192.168.1.93:3000',
    publicAppUrl: 'https://viewer-antigravity.local',
  });

  // Refs for DOM inspection & Multi-Device Sync
  const iframesRef = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const inspectedTargetRef = useRef<HTMLElement | null>(null);
  const inspectedDocRef = useRef<Document | null>(null);
  const stackedElementsRef = useRef<HTMLElement[]>([]);
  const hiddenElementsRef = useRef<
    Array<{ el: HTMLElement; prevDisplay: string; prevPointerEvents: string }>
  >([]);

  const handleIframeRef = useCallback((slotId: string, el: HTMLIFrameElement | null) => {
    if (el) {
      iframesRef.current.set(slotId, el);
    } else {
      iframesRef.current.delete(slotId);
    }
  }, []);

  // Fetch LAN & Bridge metadata on mount
  useEffect(() => {
    fetch('/api/antigravity-bridge')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setLanInfo({
            localWifiUrl: data.localWifiUrl,
            publicAppUrl: data.publicAppUrl,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Broadcast Telegram Environment simulation changes to all iframes
  const updateTgEnv = useCallback((patch: Partial<TgSimulatedEnv>) => {
    setTgEnv((prev) => {
      const next = { ...prev, ...patch };
      iframesRef.current.forEach((iframe) => {
        try {
          iframe.contentWindow?.postMessage({ type: 'tg:env-update', payload: next }, '*');
        } catch {
          // Ignore
        }
      });
      return next;
    });
  }, []);

  // Listen to Web Haptics from iframes using Singleton HapticAudioEngine
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'tg:haptic') {
        const style = (e.data.detail?.type || 'light') as ImpactStyle;
        const source = e.data.detail?.source || 'MiniApp';
        setHapticTriggered(true);
        const profile = hapticAudioEngine.play(style);
        const nowStr = new Date().toLocaleTimeString('ru-RU');

        setHapticLogs((prev) => [
          {
            id: `hap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            style,
            source,
            timestamp: nowStr,
            frequencyHz: profile.frequencyHz,
            durationMs: profile.durationMs,
          },
          ...prev.slice(0, 29),
        ]);

        setTimeout(() => setHapticTriggered(false), 240);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Multi-Device Scroll & Click Synchronizer with rAF lock
  useEffect(() => {
    if (slots.length < 2) return;
    let isSyncing = false;
    const iframes = Array.from(iframesRef.current.values()).filter(Boolean);
    const cleanupFns: Array<() => void> = [];

    iframes.forEach((sourceIframe, srcIdx) => {
      let doc: Document | null = null;
      try {
        doc = sourceIframe.contentDocument || sourceIframe.contentWindow?.document || null;
      } catch {
        return;
      }
      if (!doc) return;

      const handleScroll = (e: Event) => {
        if (isSyncing) return;
        isSyncing = true;
        window.requestAnimationFrame(() => {
          try {
            const src = (e.target === doc ? doc?.scrollingElement : (e.target as HTMLElement)) as HTMLElement | null;
            if (src && src.scrollHeight > src.clientHeight) {
              const scrollPct = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
              iframes.forEach((otherIframe, otherIdx) => {
                if (srcIdx === otherIdx) return;
                const otherDoc = otherIframe.contentDocument || otherIframe.contentWindow?.document;
                const otherScrollEl = otherDoc?.scrollingElement as HTMLElement | null;
                if (otherScrollEl && otherScrollEl.scrollHeight > otherScrollEl.clientHeight) {
                  otherScrollEl.scrollTop = scrollPct * (otherScrollEl.scrollHeight - otherScrollEl.clientHeight);
                }
              });
            }
          } catch {
            // Ignore
          } finally {
            isSyncing = false;
          }
        });
      };

      doc.addEventListener('scroll', handleScroll, { capture: true, passive: true });
      cleanupFns.push(() => doc?.removeEventListener('scroll', handleScroll, true));
    });

    return () => cleanupFns.forEach((fn) => fn());
  }, [slots]);

  // Visual layer builder state & multi-screen sync
  const [designLayers, setDesignLayers] = useState<DesignLayerNode[]>([]);
  const [activeBuilderLayerId, setActiveBuilderLayerId] = useState<string | null>(null);
  const [liveMultiScreenSync, setLiveMultiScreenSync] = useState<boolean>(true);

  const getPrimaryIframeDoc = useCallback((): Document | null => {
    const firstIframe = Array.from(iframesRef.current.values())[0];
    if (!firstIframe) return null;
    try {
      return firstIframe.contentDocument || firstIframe.contentWindow?.document || null;
    } catch {
      return null;
    }
  }, []);

  const getTargetIframeDocs = useCallback((): Document[] => {
    const allIframes = Array.from(iframesRef.current.values());
    const targetIframes = liveMultiScreenSync ? allIframes : allIframes.slice(0, 1);
    const docs: Document[] = [];
    targetIframes.forEach((iframe) => {
      try {
        const d = iframe.contentDocument || iframe.contentWindow?.document;
        if (d && d.body) docs.push(d);
      } catch {
        // Ignore cross-origin
      }
    });
    return docs;
  }, [liveMultiScreenSync]);

  const refreshDesignLayers = useCallback(
    (preferredActiveId?: string | null) => {
      const doc = getPrimaryIframeDoc();
      if (!doc || !doc.body) return;
      const extracted = extractIframeDesignLayers(doc);
      if (extracted.length === 0) return;

      setDesignLayers((prev) => {
        if (
          prev.length === extracted.length &&
          prev.every((p, idx) => {
            const e = extracted[idx];
            return (
              p.id === e.id &&
              p.transform.dx === e.transform.dx &&
              p.transform.dy === e.transform.dy &&
              p.transform.width === e.transform.width &&
              p.transform.height === e.transform.height &&
              p.textValue === e.textValue &&
              p.visible === e.visible &&
              p.locked === e.locked
            );
          })
        ) {
          return prev;
        }
        return extracted;
      });

      setActiveBuilderLayerId((prev) => {
        if (preferredActiveId !== undefined) {
          return preferredActiveId;
        }
        if (prev && extracted.some((l) => l.id === prev)) {
          return prev;
        }
        return prev ?? extracted[0]?.id ?? null;
      });
    },
    [getPrimaryIframeDoc]
  );

  // Automatically extract & refresh design layers when iframe is ready or reloaded
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let attempts = 0;
    const tryExtract = () => {
      const doc = getPrimaryIframeDoc();
      if (doc && doc.body) {
        const extracted = extractIframeDesignLayers(doc);
        if (extracted.length > 0) {
          setDesignLayers(extracted);
          return;
        }
      }
      if (attempts < 20) {
        attempts++;
        timer = setTimeout(tryExtract, 250);
      }
    };
    tryExtract();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [getPrimaryIframeDoc, targetUrl, slots]);

  // Select element helper (used by click inspector, layer switcher, and quick-select buttons)
  const selectDomElement = useCallback(
    (target: HTMLElement, doc: Document, customStack?: HTMLElement[], layerIdx = 0) => {
      inspectedTargetRef.current = target;
      inspectedDocRef.current = doc;

      // Sync with visual layer builder
      const layerId = ensureLayerAttributes(target, layerIdx);
      setActiveBuilderLayerId(layerId);
      refreshDesignLayers(layerId);

      const cls =
        typeof target.className === 'string'
          ? target.className
          : (target.className as unknown as { baseVal?: string })?.baseVal || '';
      setInitialClasses(cls);
      setLiveClasses(cls);

      const rect = target.getBoundingClientRect();
      const win = doc.defaultView || window;
      const boxModel = getBoxModelMetrics(target, win);
      const selector = buildDomSelectorPath(target);
      const { componentName, sourceFile, sourceLine } = getReactSourceInfo(target);
      const stack = customStack || stackedElementsRef.current;

      let computedTuner: StyleTunerState = {
        ...DEFAULT_TUNER_STATE,
        widthVal: Math.round(rect.width),
        widthUnit: 'px',
        heightVal: Math.round(rect.height),
        heightUnit: 'px',
        paddingX: boxModel.paddingLeft,
        paddingY: boxModel.paddingTop,
      };

      try {
        const comp = win.getComputedStyle(target);
        const radius = parseInt(comp.borderRadius || '0', 10) || 0;
        const hasBgImage = Boolean(comp && comp.backgroundImage && comp.backgroundImage !== 'none');
        const isTransparent =
          !hasBgImage &&
          (!comp || comp.backgroundColor === 'transparent' || comp.backgroundColor === 'rgba(0, 0, 0, 0)');
        const alignVal = comp?.textAlign || '';
        const currentAlign: StyleTunerState['align'] =
          alignVal === 'center'
            ? 'center'
            : alignVal === 'right'
            ? 'right'
            : alignVal === 'left'
            ? 'left'
            : 'none';

        computedTuner = {
          ...computedTuner,
          bgOpacity: isTransparent ? 0 : 100,
          radiusVal: radius,
          align: currentAlign,
        };
      } catch {
        // Fallback
      }

      setInitialTuner(computedTuner);
      setTunerState(computedTuner);
      setUndoStack([]);
      setRedoStack([]);
      setActiveLayerIndex(layerIdx);

      setSelectedElement({
        tag: target.tagName.toLowerCase(),
        id: target.id || undefined,
        className: cls,
        textSnippet: (target.innerText || '').trim().slice(0, 90),
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        boxModel,
        selector,
        componentName,
        sourceFile,
        sourceLine,
        layerIndex: layerIdx,
        totalLayers: stack.length || 1,
        coveringTag:
          layerIdx > 0 && stack[0] ? stack[0].tagName.toLowerCase() : undefined,
      });

      if (dockTab === 'layers') {
        clearSelectedOverlay(doc);
      } else {
        updateSelectedOverlay(target, doc, showBoxModel);
      }
    },
    [dockTab, showBoxModel, refreshDesignLayers]
  );

  // Quick-select a component inside the first active iframe (great for instant testing & accessibility)
  const handleQuickSelectComponent = (dataComponentName: string) => {
    const firstIframe = Array.from(iframesRef.current.values())[0];
    const doc = firstIframe?.contentDocument || firstIframe?.contentWindow?.document;
    if (!doc) return;
    const el = doc.querySelector(`[data-component="${dataComponentName}"]`) as HTMLElement | null;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const rawStack = (doc.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement[]).filter(
      (n) => n && n.tagName !== 'HTML' && n.tagName !== 'BODY' && !n.id?.startsWith('__antigravity')
    );
    const validStack = rawStack.includes(el) ? rawStack : [el, ...rawStack];
    stackedElementsRef.current = validStack;

    const summaries: LayerSummary[] = validStack.map((node, i) => {
      const info = getReactSourceInfo(node);
      const nr = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        className: typeof node.className === 'string' ? node.className : '',
        textSnippet: (node.innerText || '').trim().slice(0, 60),
        componentName: info.componentName,
        sourceFile: info.sourceFile,
        sourceLine: info.sourceLine,
        width: Math.round(nr.width),
        height: Math.round(nr.height),
        roleHint: i === 0 ? 'Верхний' : i === validStack.length - 1 ? 'Дно' : 'Под ним',
      };
    });
    setLayers(summaries);
    const idx = Math.max(0, validStack.indexOf(el));
    selectDomElement(el, doc, validStack, idx);
  };

  // rAF-Throttled Iframe Hover & Click DOM Inspector
  useEffect(() => {
    const entries = Array.from(iframesRef.current.entries()).filter(([, el]) => Boolean(el));
    if (entries.length === 0) return;

    const cleanupFns: Array<() => void> = [];

    entries.forEach(([slotId, iframe]) => {
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
        overlay.style.background = 'rgba(184, 51, 255, 0.20)';
        overlay.style.borderRadius = '6px';
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
        overlay.appendChild(tooltip);
        doc.body.appendChild(overlay);
      }

      const tooltip = doc.getElementById('__antigravity_hover_tooltip__');
      let rafId: number | null = null;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isInspectMode || !doc || rafId !== null) return;
        const target = e.target as HTMLElement;
        const clientX = e.clientX;
        const clientY = e.clientY;

        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          if (!target || target === overlay || target.id?.startsWith('__antigravity') || !doc) return;
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
            const { componentName } = getReactSourceInfo(target);
            const dims = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
            const stacked = (doc.elementsFromPoint(clientX, clientY) as HTMLElement[]).filter(
              (el) => el && el.tagName !== 'HTML' && el.tagName !== 'BODY' && !el.id?.startsWith('__antigravity')
            );
            tooltip.textContent = `<${tag}>${componentName ? ` [${componentName}]` : ''} ${dims}px · Слоёв: ${stacked.length}`;
          }
        });
      };

      const handleClick = (e: MouseEvent) => {
        if (!isInspectMode || !doc) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        if (!target || target === overlay || target.id?.startsWith('__antigravity')) return;

        const rawElements = (doc.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]) || [];
        const validElements = rawElements.filter(
          (el) => el && el.tagName !== 'HTML' && el.tagName !== 'BODY' && !el.id?.startsWith('__antigravity')
        );
        if (!validElements.includes(target)) validElements.unshift(target);

        stackedElementsRef.current = validElements;
        const slot = slots.find((s) => s.id === slotId) || slots[0];
        const spec = PREVIEW_DEVICES[slot?.deviceKey] || PREVIEW_DEVICES.iphone16pro;
        setInspectedSlotName(spec.name);

        const summaries: LayerSummary[] = validElements.map((el, i) => {
          const info = getReactSourceInfo(el);
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            textSnippet: (el.innerText || '').trim().slice(0, 60),
            componentName: info.componentName,
            sourceFile: info.sourceFile,
            sourceLine: info.sourceLine,
            width: Math.round(r.width),
            height: Math.round(r.height),
            roleHint: i === 0 ? 'Верхний' : i === validElements.length - 1 ? 'Дно' : 'Под ним',
          };
        });
        setLayers(summaries);

        const targetIdx = e.altKey && validElements.length > 1 ? 1 : 0;
        selectDomElement(validElements[targetIdx], doc, validElements, targetIdx);
        setIsInspectMode(false);
        if (overlay) overlay.style.display = 'none';
      };

      doc.addEventListener('mousemove', handleMouseMove, true);
      doc.addEventListener('click', handleClick, true);

      cleanupFns.push(() => {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        if (doc) {
          doc.removeEventListener('mousemove', handleMouseMove, true);
          doc.removeEventListener('click', handleClick, true);
          const ov = doc.getElementById('__antigravity_hover_overlay__');
          if (ov) ov.remove();
          doc.body.style.cursor = 'default';
        }
      });
    });

    return () => cleanupFns.forEach((fn) => fn());
  }, [isInspectMode, slots, selectDomElement]);

  // Apply Visual Style Tuner changes with Undo/Redo history
  const applyTunerStyle = (changes: Partial<StyleTunerState>, recordUndo = true) => {
    if (recordUndo) {
      setUndoStack((prev) => [...prev.slice(-19), tunerState]);
      setRedoStack([]);
    }
    const next = { ...tunerState, ...changes };
    setTunerState(next);

    const el = inspectedTargetRef.current;
    const doc = inspectedDocRef.current;
    if (!el) return;

    el.style.opacity = '1';

    if (changes.bgOpacity !== undefined) {
      if (next.bgOpacity === 0) {
        el.style.background = 'transparent';
        el.style.backgroundColor = 'transparent';
        el.style.backgroundImage = 'none';
      } else {
        const alpha = (next.bgOpacity / 100).toFixed(2);
        el.style.backgroundColor = isDark ? `rgba(28, 20, 48, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
        el.style.backgroundImage = 'none';
      }
    }

    if (changes.align !== undefined) {
      if (next.align === 'left') {
        el.style.textAlign = 'left';
      } else if (next.align === 'center') {
        el.style.textAlign = 'center';
      } else if (next.align === 'right') {
        el.style.textAlign = 'right';
      } else {
        el.style.textAlign = '';
      }
    }

    if (changes.widthVal !== undefined || changes.widthUnit !== undefined) {
      el.style.width = next.widthUnit === 'auto' ? '' : `${next.widthVal}${next.widthUnit}`;
    }

    if (changes.heightVal !== undefined || changes.heightUnit !== undefined) {
      el.style.height = next.heightUnit === 'auto' ? '' : `${next.heightVal}${next.heightUnit}`;
    }

    if (changes.radiusVal !== undefined) {
      el.style.borderRadius = `${next.radiusVal}px`;
    }

    if (doc) {
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setSelectedElement((prev) =>
          prev
            ? {
                ...prev,
                rect: {
                  top: Math.round(r.top),
                  left: Math.round(r.left),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                },
              }
            : null
        );
        if (dockTab !== 'layers') {
          updateSelectedOverlay(el, doc, showBoxModel);
        }
      });
    }
  };

  const handleUndoTuner = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [tunerState, ...r]);
    applyTunerStyle(previous, false);
  };

  const handleRedoTuner = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((r) => r.slice(1));
    setUndoStack((s) => [...s, tunerState]);
    applyTunerStyle(next, false);
  };

  // Compute live diffs between initial snapshot and current tuner state
  const currentDiffs = React.useMemo(
    () =>
      selectedElement
        ? computeStyleDiff(initialTuner, tunerState, initialClasses, liveClasses)
        : [],
    [selectedElement, initialTuner, tunerState, initialClasses, liveClasses]
  );

  // Enqueue current inspected element into Agent Prompt Queue
  const handleEnqueueCurrentElement = useCallback(() => {
    if (!selectedElement) return;
    const nextPin = agentQueue.length > 0 ? Math.max(...agentQueue.map((i) => i.pinNumber)) + 1 : 1;
    const newItem: AgentQueueItem = {
      id: `task-${Date.now()}`,
      pinNumber: nextPin,
      createdAt: new Date().toLocaleTimeString('ru-RU'),
      slotDeviceName: inspectedSlotName,
      element: selectedElement,
      diffs: currentDiffs,
      directiveId: selectedDirectiveId || undefined,
      note: noteText.trim() || 'Примени подобранные настройки стилей в исходном компоненте.',
      priority: 'normal',
    };
    setAgentQueue((prev) => [...prev, newItem]);
    setEnqueuedFeedback(true);
    setTimeout(() => setEnqueuedFeedback(false), 2000);
  }, [selectedElement, agentQueue, inspectedSlotName, currentDiffs, selectedDirectiveId, noteText]);

  // Run automated layout & safe area audit on first active iframe
  const handleRunLayoutAudit = useCallback(() => {
    const firstSlot = slots[0];
    const firstIframe = firstSlot ? iframesRef.current.get(firstSlot.id) : null;
    const doc = firstIframe?.contentDocument || firstIframe?.contentWindow?.document;
    if (!doc || !firstSlot) return;

    const spec = PREVIEW_DEVICES[firstSlot.deviceKey] || PREVIEW_DEVICES.iphone16pro;
    const detected = scanIframeForAuditIssues(doc, spec, firstSlot.rotated);
    setAuditIssues(detected);
  }, [slots]);

  // Fit-to-viewport auto zoom
  const handleFitZoom = useCallback(() => {
    const container = canvasContainerRef.current;
    const cw = container?.clientWidth || 920;
    const ch = container?.clientHeight || 780;
    const mapped = slots.map((s) => {
      const spec = PREVIEW_DEVICES[s.deviceKey] || PREVIEW_DEVICES.iphone16pro;
      return { w: spec.w, h: spec.h, rotated: s.rotated, showBezel };
    });
    setZoom(calculateFitZoom(mapped, cw, ch));
  }, [slots, showBezel]);

  // Apply multi-device Workspace Preset
  const handleApplyPreset = useCallback((presetId: string) => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSlots(
      preset.slots.map((s, idx) => ({
        id: `slot-${idx + 1}-${Date.now()}`,
        deviceKey: s.deviceKey,
        rotated: s.rotated,
      }))
    );
    setZoom(preset.recommendedZoom);
    setDockTab('layers');
  }, []);

  // Global keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        setIsInspectMode(false);
        setShowCommandPalette(false);
        setShowTunnelModal(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л')) {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      if (isInput) return;

      if (e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ш')) {
        e.preventDefault();
        setIsInspectMode((prev) => !prev);
      } else if (e.altKey && (e.key === 'q' || e.key === 'Q' || e.key === 'й')) {
        e.preventDefault();
        handleEnqueueCurrentElement();
      } else if (e.altKey && (e.key === 'b' || e.key === 'B' || e.key === 'и')) {
        e.preventDefault();
        setShowBoxModel((prev) => !prev);
        setShowSafeArea((prev) => !prev);
      } else if (e.altKey && e.key === '0') {
        e.preventDefault();
        handleFitZoom();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleEnqueueCurrentElement, handleFitZoom]);

  const workspaceMeta = {
    url: targetUrl,
    theme: currentTheme.name,
    activeDevices: slots.map((s) => (PREVIEW_DEVICES[s.deviceKey] || PREVIEW_DEVICES.iphone16pro).name),
  };

  const handleCopySingleElementPrompt = () => {
    if (!selectedElement) return;
    const singleItem: AgentQueueItem = {
      id: 'single',
      pinNumber: 1,
      createdAt: new Date().toLocaleTimeString('ru-RU'),
      slotDeviceName: inspectedSlotName,
      element: selectedElement,
      diffs: currentDiffs,
      directiveId: selectedDirectiveId || undefined,
      note: noteText,
      priority: 'high',
    };
    const prompt = buildConsolidatedAgentPrompt([singleItem], workspaceMeta);
    navigator.clipboard.writeText(prompt);
    setCopiedSingle(true);
    setTimeout(() => setCopiedSingle(false), 2000);
  };

  const updateHiddenLayersCount = useCallback(() => {
    const doc = getPrimaryIframeDoc();
    if (!doc) {
      setHiddenCount(0);
      return;
    }
    setHiddenCount(countDomHiddenLayers(doc));
  }, [getPrimaryIframeDoc]);

  const handleToggleHideLayer = () => {
    const doc = getPrimaryIframeDoc();
    if (!doc) return;

    let layerId = activeBuilderLayerId;
    if (!layerId && inspectedTargetRef.current) {
      layerId = inspectedTargetRef.current.getAttribute('data-ag-layer-id');
    }
    if (!layerId && selectedElement) {
      layerId = selectedElement.id || null;
    }
    if (!layerId) return;

    const docs = getTargetIframeDocs();
    docs.forEach((d) => toggleDomLayerVisibility(d, layerId!));
    updateHiddenLayersCount();
    refreshDesignLayers(layerId);
  };

  const handleRestoreHiddenLayers = () => {
    const docs = getTargetIframeDocs();
    docs.forEach((d) => {
      restoreAllDomHiddenLayers(d);
    });
    hiddenElementsRef.current.forEach((h) => {
      h.el.style.display = h.prevDisplay;
      h.el.style.pointerEvents = h.prevPointerEvents;
    });
    hiddenElementsRef.current = [];
    setHiddenCount(0);
    refreshDesignLayers(activeBuilderLayerId);

    const doc = getPrimaryIframeDoc();
    if (doc && activeBuilderLayerId) {
      const el = findDomElementByLayerId(doc, activeBuilderLayerId);
      if (el) selectDomElement(el, doc);
    }
  };

  const handleNavigateHierarchy = (dir: 'parent' | 'child') => {
    const doc = getPrimaryIframeDoc();
    if (!doc) return;

    let currentEl = inspectedTargetRef.current;
    if (!currentEl && activeBuilderLayerId) {
      currentEl = findDomElementByLayerId(doc, activeBuilderLayerId);
    }
    if (!currentEl) {
      const stack = stackedElementsRef.current;
      if (stack.length > 0) {
        const nextIdx = dir === 'parent' ? activeLayerIndex + 1 : activeLayerIndex - 1;
        if (nextIdx >= 0 && nextIdx < stack.length) {
          selectDomElement(stack[nextIdx], doc, stack, nextIdx);
        }
      }
      return;
    }

    if (dir === 'parent') {
      const parentEl = currentEl.parentElement?.closest('[data-ag-layer-id]') as HTMLElement | null;
      if (parentEl) {
        selectDomElement(parentEl, doc);
      }
    } else {
      const childEl = currentEl.querySelector('[data-ag-layer-id]') as HTMLElement | null;
      if (childEl) {
        selectDomElement(childEl, doc);
      }
    }
  };

  // --- VISUAL WEBSITE BUILDER & LAYER TREE ENGINE ---
  const [dockMode, setDockMode] = useState<'inspector' | 'builder'>('inspector');
  const [dockPosition, setDockPosition] = useState<'left' | 'right'>('left');
  const [dockWidth, setDockWidth] = useState<number>(350);
  const [isResizingDock, setIsResizingDock] = useState<boolean>(false);
  const [inspectorAgentOpen, setInspectorAgentOpen] = useState<boolean>(false);
  const [checkedLayerIds, setCheckedLayerIds] = useState<string[]>([]);
  const [snapGridSize, setSnapGridSize] = useState<number>(8);
  const [builderOps, setBuilderOps] = useState<BuilderOperationRecord[]>([]);
  const [builderEnqueuedToast, setBuilderEnqueuedToast] = useState(false);
  const [canvasEyedropperTarget, setCanvasEyedropperTarget] = useState<'bg' | 'text' | 'icon' | null>(
    null
  );
  const [hoveredEyedropperHex, setHoveredEyedropperHex] = useState<string | null>(null);
  const [latestScreenshot, setLatestScreenshot] =
    useState<VisualTechnicalScreenshotResult | null>(null);

  // Interactive Dock Width Resizer (280px - 620px)
  useEffect(() => {
    if (!isResizingDock) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rawWidth =
        dockPosition === 'left' ? e.clientX : window.innerWidth - e.clientX;
      const clamped = Math.max(280, Math.min(620, Math.round(rawWidth)));
      setDockWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizingDock(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDock, dockPosition]);

  // Replay active builder state onto newly mounted secondary screens when slots change
  useEffect(() => {
    if (!liveMultiScreenSync || slots.length < 2 || designLayers.length === 0) return;
    const replayToSecondary = () => {
      const docs = getTargetIframeDocs();
      if (docs.length < 2) return;
      const secondaryDocs = docs.slice(1);
      secondaryDocs.forEach((secDoc) => {
        const secLayers = extractIframeDesignLayers(secDoc);
        if (secLayers.length === 0) return;
        designLayers.forEach((layer) => {
          if (
            layer.textValue !== undefined &&
            layer.initialTextValue !== undefined &&
            layer.textValue !== layer.initialTextValue
          ) {
            updateDomLayerText(secDoc, layer.id, layer.textValue);
          }
          if (layer.iconPresetId || layer.customSvgCode || layer.iconColor) {
            updateDomLayerIcon(secDoc, layer.id, {
              presetId: layer.iconPresetId,
              customSvg: layer.customSvgCode,
              iconColor: layer.iconColor,
            });
          }
          if (
            layer.transform.dx !== 0 ||
            layer.transform.dy !== 0 ||
            layer.transform.responsivePreset !== 'none' ||
            (layer.transform.boxAlign && layer.transform.boxAlign !== 'none') ||
            (layer.transform.contentAlign && layer.transform.contentAlign !== 'none') ||
            Math.abs(layer.transform.width - layer.initialRect.width) > 1 ||
            Math.abs(layer.transform.height - layer.initialRect.height) > 1 ||
            layer.transform.zIndex !== 0
          ) {
            applyLayerTransformToDom(secDoc, layer.id, layer.transform);
          }
        });
      });
    };
    const t1 = setTimeout(replayToSecondary, 700);
    const t2 = setTimeout(replayToSecondary, 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [slots.length, liveMultiScreenSync, designLayers, getTargetIframeDocs]);

  // Sync the interactive 8-handle Bounding Box Gizmo inside the iframe when in builder mode
  useEffect(() => {
    const doc = getPrimaryIframeDoc();
    if (!doc || !doc.body) return;

    if (dockTab !== 'layers') {
      syncBuilderGizmoInIframe(doc, null, snapGridSize, () => {});
      if (inspectedTargetRef.current && inspectedDocRef.current) {
        updateSelectedOverlay(inspectedTargetRef.current, inspectedDocRef.current, showBoxModel);
      }
      return;
    }

    clearSelectedOverlay(doc);
    syncBuilderGizmoInIframe(
      doc,
      activeBuilderLayerId,
      snapGridSize,
      (layerId, patch, opType) => {
        // Broadcast Gizmo drag/resize to all secondary screens if liveMultiScreenSync is enabled
        const docs = getTargetIframeDocs();
        docs.slice(1).forEach((secDoc) => {
          applyLayerTransformToDom(secDoc, layerId, patch);
        });

        const extracted = extractIframeDesignLayers(doc);
        setDesignLayers(extracted);
        const layerObj = extracted.find((l) => l.id === layerId);
        if (layerObj) {
          setBuilderOps((prev) => [
            {
              id: `op-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString('ru-RU'),
              type: opType,
              layerId,
              layerName: layerObj.name,
              summary:
                opType === 'move'
                  ? `Перемещение ${layerObj.name} на (${patch.dx}px, ${patch.dy}px)`
                  : patch.widthUnit === '%'
                  ? `Адаптивное растягивание ${layerObj.name}: ${patch.widthPercent}%`
                  : `Растягивание рамки ${layerObj.name} до ${patch.width}×${patch.height}px`,
              tailwindHint: formatLayerBuilderDiff(layerObj, []).tailwindClasses,
            },
            ...prev.slice(0, 19),
          ]);
        }
      },
      (clickedLayerId) => {
        setActiveBuilderLayerId(clickedLayerId);
        const el = findDomElementByLayerId(doc, clickedLayerId);
        if (el) {
          selectDomElement(el, doc);
        }
      },
      (editedLayerId, newInlineText) => {
        const docs = getTargetIframeDocs();
        docs.forEach((d) => updateDomLayerText(d, editedLayerId, newInlineText));
        refreshDesignLayers(editedLayerId);
      }
    );
  }, [
    dockTab,
    activeBuilderLayerId,
    snapGridSize,
    showBoxModel,
    getPrimaryIframeDoc,
    getTargetIframeDocs,
    refreshDesignLayers,
    selectDomElement,
  ]);

  const handleSwitchToBuilderMode = () => {
    setDockTab('layers');
    setTimeout(() => refreshDesignLayers(), 60);
  };

  const handleEnableAdaptiveTwoScreens = () => {
    setSlots([
      { id: 'slot-1', deviceKey: 'iphone16pro', rotated: false },
      { id: `slot-2-${Date.now()}`, deviceKey: 'compact320', rotated: false },
    ]);
    setZoom(0.76);
  };

  const handleBuilderTransformLayer = (
    layerId: string,
    patch: Partial<DesignLayerTransform>,
    opSummary: string
  ) => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    let updated: DesignLayerNode | null = null;
    docs.forEach((d, idx) => {
      const res = applyLayerTransformToDom(d, layerId, patch);
      if (idx === 0) updated = res;
    });
    const extracted = extractIframeDesignLayers(docs[0]);
    setDesignLayers(extracted);
    const finalNode = updated || extracted.find((l) => l.id === layerId);
    if (finalNode) {
      setBuilderOps((prev) => [
        {
          id: `op-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('ru-RU'),
          type:
            patch.responsivePreset !== undefined || patch.widthUnit !== undefined
              ? 'responsive'
              : patch.width !== undefined || patch.height !== undefined
              ? 'resize'
              : 'move',
          layerId,
          layerName: finalNode.name,
          summary: opSummary,
          tailwindHint: formatLayerBuilderDiff(finalNode, []).tailwindClasses,
        },
        ...prev.slice(0, 19),
      ]);
    }
  };

  const handleBuilderUpdateText = (layerId: string, newText: string) => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    docs.forEach((d) => updateDomLayerText(d, layerId, newText));
    const extracted = extractIframeDesignLayers(docs[0]);
    setDesignLayers(extracted);
    const target = extracted.find((l) => l.id === layerId);
    if (target) {
      setBuilderOps((prev) => [
        {
          id: `op-txt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('ru-RU'),
          type: 'text',
          layerId,
          layerName: target.name,
          summary: `Текст в ${target.name} изменён на "${newText}"`,
          tailwindHint: '',
          jsxStructuralHint: `Обновить текстовое содержимое узла <${target.name}> на "${newText}"`,
        },
        ...prev.slice(0, 19),
      ]);
    }
  };

  const handleBuilderUpdateTextColor = useCallback(
    (layerId: string, colorHex: string) => {
      const docs = getTargetIframeDocs();
      if (docs.length === 0) return;
      docs.forEach((d) => updateDomLayerTextColor(d, layerId, colorHex));
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      const target = extracted.find((l) => l.id === layerId);
      if (target) {
        setBuilderOps((prev) => [
          {
            id: `op-txt-color-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'text',
            layerId,
            layerName: target.name,
            summary: `Цвет текста ${target.name}: ${colorHex}`,
            tailwindHint: `text-[${colorHex}]`,
            jsxStructuralHint: `Установить цвет текста узла <${target.name}>: text-[${colorHex}]`,
          },
          ...prev.slice(0, 19),
        ]);
      }
    },
    [getTargetIframeDocs]
  );

  const handleBuilderUpdateBgColor = useCallback(
    (layerId: string, colorHex: string) => {
      const docs = getTargetIframeDocs();
      if (docs.length === 0) return;
      docs.forEach((d) => updateDomLayerBgColor(d, layerId, colorHex));
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      const target = extracted.find((l) => l.id === layerId);
      if (target) {
        setBuilderOps((prev) => [
          {
            id: `op-bg-color-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'style',
            layerId,
            layerName: target.name,
            summary: `Цвет фона ${target.name}: ${colorHex}`,
            tailwindHint: `bg-[${colorHex}]`,
            jsxStructuralHint: `Установить цвет фона узла <${target.name}>: bg-[${colorHex}]`,
          },
          ...prev.slice(0, 19),
        ]);
      }
    },
    [getTargetIframeDocs]
  );

  const handleBuilderUpdateIcon = useCallback(
    (
      layerId: string,
      options: { presetId?: string; customSvg?: string; iconColor?: string },
      summary: string
    ) => {
      const docs = getTargetIframeDocs();
      if (docs.length === 0) return;
      docs.forEach((d) => updateDomLayerIcon(d, layerId, options));
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      const target = extracted.find((l) => l.id === layerId);
      if (target) {
        setBuilderOps((prev) => [
          {
            id: `op-icon-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'icon',
            layerId,
            layerName: target.name,
            summary,
            tailwindHint: options.iconColor ? `text-[${options.iconColor}]` : '',
            jsxStructuralHint: summary,
          },
          ...prev.slice(0, 19),
        ]);
      }
    },
    [getTargetIframeDocs]
  );

  // Interactive Canvas Eyedropper on the Phone Mockup Iframes
  useEffect(() => {
    if (!canvasEyedropperTarget) {
      return;
    }

    const iframes = Array.from(iframesRef.current.values()).filter(Boolean);
    const cleanupFns: Array<() => void> = [];

    iframes.forEach((iframe) => {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument || iframe.contentWindow?.document || null;
      } catch {
        return;
      }
      if (!doc || !doc.body) return;

      const win = doc.defaultView || window;
      const prevCursor = doc.body.style.cursor;
      doc.body.style.cursor = 'crosshair';
      doc.body.setAttribute('data-ag-eyedropper-active', 'true');

      // 1:1 rendered surface pixel buffer of the displayed mobile screen
      let surfaceCanvas = renderScreenSurfaceCanvas(doc);
      const refreshSurface = () => {
        if (doc) {
          surfaceCanvas = renderScreenSurfaceCanvas(doc);
        }
      };

      // Floating loupe above the eyedropper cursor: color square + #HEX code
      let loupe = doc.getElementById('__antigravity_eyedropper_loupe__') as HTMLDivElement | null;
      if (!loupe) {
        loupe = doc.createElement('div');
        loupe.id = '__antigravity_eyedropper_loupe__';
        loupe.setAttribute('data-testid', 'eyedropper-cursor-loupe');
        loupe.style.cssText = [
          'position: fixed',
          'pointer-events: none',
          'z-index: 2147483647',
          'display: none',
          'align-items: center',
          'gap: 6px',
          'padding: 4px 8px',
          'border-radius: 6px',
          'background: #141417',
          'border: 1px solid #2E2E36',
          'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.65)',
          'color: #FAFAFA',
          'font-family: ui-monospace, SFMono-Regular, Menlo, monospace',
          'font-size: 11px',
          'font-weight: 600',
          'line-height: 1',
          'white-space: nowrap',
          'transform: translate(-50%, -135%)',
        ].join(';');

        const swatch = doc.createElement('span');
        swatch.id = '__antigravity_eyedropper_swatch__';
        swatch.style.cssText = [
          'width: 12px',
          'height: 12px',
          'border-radius: 3px',
          'border: 1px solid rgba(255, 255, 255, 0.35)',
          'flex-shrink: 0',
          'background: #0E0D15',
        ].join(';');

        const hexLabel = doc.createElement('span');
        hexLabel.id = '__antigravity_eyedropper_hex__';
        hexLabel.textContent = '#0E0D15';

        loupe.appendChild(swatch);
        loupe.appendChild(hexLabel);
        doc.body.appendChild(loupe);
      }

      const onMove = (e: MouseEvent) => {
        if (!doc) return;
        const sampled = sampleScreenColorAtPoint(doc, e.clientX, e.clientY, surfaceCanvas);
        setHoveredEyedropperHex(sampled);

        if (loupe) {
          loupe.style.display = 'flex';
          // Clamp near top edge so badge remains visible inside viewport
          const clampedX = Math.max(46, Math.min((win.innerWidth || 390) - 46, e.clientX));
          const clampedY = Math.max(32, e.clientY);
          loupe.style.left = `${clampedX}px`;
          loupe.style.top = `${clampedY}px`;
          const swatchEl = doc.getElementById('__antigravity_eyedropper_swatch__') as HTMLElement | null;
          const hexEl = doc.getElementById('__antigravity_eyedropper_hex__') as HTMLElement | null;
          if (swatchEl) swatchEl.style.backgroundColor = sampled;
          if (hexEl) hexEl.textContent = sampled;
        }
      };

      const onLeave = () => {
        if (loupe) {
          loupe.style.display = 'none';
        }
      };

      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!doc) return;
        const sampled = sampleScreenColorAtPoint(doc, e.clientX, e.clientY, surfaceCanvas);
        const targetLayerId = activeBuilderLayerId || designLayers[0]?.id;
        if (targetLayerId) {
          if (canvasEyedropperTarget === 'bg') {
            handleBuilderUpdateBgColor(targetLayerId, sampled);
          } else if (canvasEyedropperTarget === 'text') {
            handleBuilderUpdateTextColor(targetLayerId, sampled);
          } else {
            handleBuilderUpdateIcon(
              targetLayerId,
              { iconColor: sampled },
              `Цвет иконки (пипетка с макета): ${sampled}`
            );
          }
        }
        setCanvasEyedropperTarget(null);
        setHoveredEyedropperHex(null);
      };

      win.addEventListener('mousemove', onMove, true);
      win.addEventListener('mouseleave', onLeave, true);
      win.addEventListener('scroll', refreshSurface, true);
      win.addEventListener('click', onClick, true);

      cleanupFns.push(() => {
        if (doc && doc.body) {
          doc.body.style.cursor = prevCursor;
          doc.body.removeAttribute('data-ag-eyedropper-active');
          win.removeEventListener('mousemove', onMove, true);
          win.removeEventListener('mouseleave', onLeave, true);
          win.removeEventListener('scroll', refreshSurface, true);
          win.removeEventListener('click', onClick, true);
          const existingLoupe = doc.getElementById('__antigravity_eyedropper_loupe__');
          if (existingLoupe) existingLoupe.remove();
        }
      });
    });

    return () => cleanupFns.forEach((fn) => fn());
  }, [
    canvasEyedropperTarget,
    activeBuilderLayerId,
    designLayers,
    handleBuilderUpdateBgColor,
    handleBuilderUpdateTextColor,
    handleBuilderUpdateIcon,
  ]);

  const handleCaptureSlotScreenshot = (
    slotId: string,
    cropRect: { x: number; y: number; width: number; height: number },
    mode: 'full' | 'region'
  ) => {
    const iframe =
      iframesRef.current.get(slotId) || Array.from(iframesRef.current.values())[0];
    const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (!doc) return;
    const slot = slots.find((s) => s.id === slotId) || slots[0];
    const spec = PREVIEW_DEVICES[slot?.deviceKey] || PREVIEW_DEVICES.iphone16pro;
    const shot = captureVisualTechnicalScreenshot(doc, cropRect, spec.name, mode);
    setLatestScreenshot(shot);
  };

  const handleEnqueueScreenshot = (shot: VisualTechnicalScreenshotResult) => {
    const nextPin =
      agentQueue.length > 0 ? Math.max(...agentQueue.map((i) => i.pinNumber)) + 1 : 1;
    const firstObj = shot.objects[0];
    const objectNamesSummary = shot.objects
      .slice(0, 6)
      .map((o) => `${o.name} (<${o.tag}>)`)
      .join(', ');

    const newItem: AgentQueueItem = {
      id: `shot-task-${Date.now()}`,
      pinNumber: nextPin,
      createdAt: shot.timestamp,
      slotDeviceName: shot.deviceName,
      priority: 'high',
      directiveId: 'responsive-320',
      note: `Визуально-технический скриншот (${
        shot.mode === 'full' ? 'весь экран' : `область ${shot.cropRect.width}×${shot.cropRect.height}px`
      }). Объекты в кадре (${shot.objects.length}): ${objectNamesSummary}`,
      element: {
        tag: firstObj?.tag || 'section',
        className: `crop-[${shot.cropRect.x},${shot.cropRect.y},${shot.cropRect.width}x${shot.cropRect.height}]`,
        textSnippet:
          firstObj?.textSnippet || `Объектов в скриншоте: ${shot.objects.length}`,
        rect: {
          top: shot.cropRect.y,
          left: shot.cropRect.x,
          width: shot.cropRect.width,
          height: shot.cropRect.height,
        },
        selector: firstObj?.selector || 'main',
        componentName: firstObj?.name || 'ScreenRegionCapture',
        sourceFile: firstObj?.sourceFile || 'components/demo/DemoApp.tsx',
        sourceLine: firstObj?.sourceLine || 1,
      },
      diffs: shot.objects.slice(0, 8).map((o) => ({
        property: `Объект #${o.index}: ${o.name}`,
        before: `${o.rect.width}×${o.rect.height}px @ (${o.rect.x},${o.rect.y})`,
        after: o.textSnippet ? `"${o.textSnippet}" (${o.colorHex})` : `Цвет: ${o.colorHex}`,
        tailwindSuggestion: `<${o.tag}> ${o.sourceFile || ''}${o.sourceLine ? `:${o.sourceLine}` : ''}`,
      })),
    };

    setAgentQueue((prev) => [...prev, newItem]);
  };

  const handleBuilderReorderLayer = (layerId: string, direction: 'up' | 'down') => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    let moved = false;
    docs.forEach((d, idx) => {
      const ok = swapDomLayerOrder(d, layerId, direction);
      if (idx === 0) moved = ok;
    });
    if (moved) {
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      const target = extracted.find((l) => l.id === layerId);
      if (target) {
        setBuilderOps((prev) => [
          {
            id: `op-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'reorder',
            layerId,
            layerName: target.name,
            summary: `Перестановка слоя ${target.name} ${direction === 'up' ? 'выше' : 'ниже'} в DOM`,
            tailwindHint: 'Изменение порядка JSX-узлов в родителе',
            jsxStructuralHint: `Переместить JSX-узел <${target.name}> ${
              direction === 'up'
                ? 'выше предыдущего соседнего элемента'
                : 'ниже следующего соседнего элемента'
            }`,
          },
          ...prev.slice(0, 19),
        ]);
      }
    }
  };

  const handleBuilderGroupLayers = (customIds?: string[]) => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    const idsToGroup = customIds || checkedLayerIds;
    if (idsToGroup.length < 2) return;
    const names = designLayers
      .filter((l) => idsToGroup.includes(l.id))
      .map((l) => l.name)
      .join(' + ');
    let newGroupId: string | null = null;
    docs.forEach((d, idx) => {
      const gid = groupDomLayers(d, idsToGroup);
      if (idx === 0) newGroupId = gid;
    });
    if (newGroupId) {
      setCheckedLayerIds([]);
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      setActiveBuilderLayerId(newGroupId);
      const groupNode = extracted.find((l) => l.id === newGroupId);
      setBuilderOps((prev) => [
        {
          id: `op-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('ru-RU'),
          type: 'group',
          layerId: newGroupId!,
          layerName: groupNode?.name || 'Group',
          summary: `Группировка слоёв (${names}) в единый контейнер`,
          tailwindHint: 'flex flex-col gap-2 p-2 rounded-2xl w-full',
          jsxStructuralHint: `Обернуть элементы [${names}] в общий контейнер <div className="flex flex-col gap-2 w-full">`,
        },
        ...prev.slice(0, 19),
      ]);
    }
  };

  const handleBuilderUngroupLayer = (groupLayerId: string) => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    const groupNode = designLayers.find((l) => l.id === groupLayerId);
    let ok = false;
    docs.forEach((d, idx) => {
      const res = ungroupDomLayer(d, groupLayerId);
      if (idx === 0) ok = res;
    });
    if (ok) {
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      setActiveBuilderLayerId(extracted[0]?.id || null);
      if (groupNode) {
        setBuilderOps((prev) => [
          {
            id: `op-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'ungroup',
            layerId: groupLayerId,
            layerName: groupNode.name,
            summary: `Разгруппировка контейнера ${groupNode.name}`,
            tailwindHint: '',
            jsxStructuralHint: `Убрать обёртку группы ${groupNode.name} и вернуть дочерние элементы в родительский контейнер`,
          },
          ...prev.slice(0, 19),
        ]);
      }
    }
  };

  const handleBuilderDuplicateLayer = (layerId: string) => {
    const docs = getTargetIframeDocs();
    if (docs.length === 0) return;
    const orig = designLayers.find((l) => l.id === layerId);
    let clonedId: string | null = null;
    docs.forEach((d, idx) => {
      const cid = duplicateDomLayer(d, layerId);
      if (idx === 0) clonedId = cid;
    });
    if (clonedId) {
      const extracted = extractIframeDesignLayers(docs[0]);
      setDesignLayers(extracted);
      setActiveBuilderLayerId(clonedId);
      if (orig) {
        setBuilderOps((prev) => [
          {
            id: `op-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('ru-RU'),
            type: 'duplicate',
            layerId: clonedId!,
            layerName: orig.name,
            summary: `Дублирование слоя ${orig.name}`,
            tailwindHint: '',
            jsxStructuralHint: `Продублировать компонент <${orig.name}> сразу после оригинала`,
          },
          ...prev.slice(0, 19),
        ]);
      }
    }
  };

  const handleEnqueueBuilderLayer = (layer: DesignLayerNode) => {
    const diffInfo = formatLayerBuilderDiff(layer, builderOps);
    const nextPin = agentQueue.length > 0 ? Math.max(...agentQueue.map((i) => i.pinNumber)) + 1 : 1;

    const diffs = diffInfo.summaryLines.map((line) => ({
      property: 'Конструктор слоёв',
      before: layer.initialTextValue || `${layer.initialRect.width}×${layer.initialRect.height}px`,
      after: line,
      tailwindSuggestion: diffInfo.tailwindClasses || 'w-full max-w-full',
    }));

    const newItem: AgentQueueItem = {
      id: `builder-task-${Date.now()}`,
      pinNumber: nextPin,
      createdAt: new Date().toLocaleTimeString('ru-RU'),
      slotDeviceName:
        liveMultiScreenSync && slots.length > 1
          ? `${inspectedSlotName} (+${slots.length - 1} экр.)`
          : inspectedSlotName,
      priority: 'high',
      directiveId: selectedDirectiveId || 'responsive-320',
      note:
        noteText
          ? `${noteText} (${diffInfo.summaryLines.join('; ') || 'правка стилей'})`
          : diffInfo.summaryLines.length > 0
          ? `Применить изменения конструктора слоёв для ${layer.name}: ${diffInfo.summaryLines.join('; ')}`
          : `Обновить расположение, текст и адаптивную вёрстку слоя ${layer.name}`,
      element: {
        tag: layer.tag,
        className: diffInfo.tailwindClasses,
        textSnippet: layer.textValue || layer.name,
        rect: {
          top: layer.currentRect.y,
          left: layer.currentRect.x,
          width: layer.currentRect.width,
          height: layer.currentRect.height,
        },
        selector: layer.selector || (selectedElement?.selector || `.${layer.name}`),
        componentName: layer.name,
        sourceFile: layer.sourceFile || selectedElement?.sourceFile || 'components/demo/DemoApp.tsx',
        sourceLine: layer.sourceLine || selectedElement?.sourceLine || 97,
      },
      diffs,
    };

    setAgentQueue((prev) => [...prev, newItem]);
    setBuilderEnqueuedToast(true);
    setTimeout(() => setBuilderEnqueuedToast(false), 2000);
  };

  return (
    <div
      className={`h-screen overflow-hidden flex flex-col transition-colors duration-150 ${currentTheme.canvasBg} ${currentTheme.textPrimary}`}
    >
      {/* UNIFIED COMPACT SINGLE-ROW HEADER & TOOLBAR (44px, Linear / Figma Style) */}
      <header
        className={`h-11 shrink-0 flex items-center justify-between gap-3 px-3 border-b ${currentTheme.surfaceBg} ${currentTheme.borderClass}`}
      >
        {/* Left Zone: Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-bold tracking-tight whitespace-nowrap shrink-0 font-display px-1 select-none">
            Viewer 2.0
          </span>
        </div>

        {/* Center/Right Compact Workspace Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
              {/* Add Screen Slot */}
              <button
                type="button"
                disabled={slots.length >= 3}
                title={`Добавить экран предпросмотра (сейчас открыто ${slots.length} из 3)`}
                aria-label="Добавить экран"
                onClick={() => {
                  if (slots.length >= 3) return;
                  const nextKey = slots.length === 1 ? 's24ultra' : 'iphonese';
                  setSlots((prev) => [
                    ...prev,
                    { id: `slot-${Date.now()}`, deviceKey: nextKey, rotated: false },
                  ]);
                }}
                className={`h-7 px-2 rounded-md border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  slots.length >= 3
                    ? 'opacity-35 cursor-not-allowed border-zinc-800'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="font-mono">{slots.length}/3</span>
              </button>

              {/* Preset Quick Switcher */}
              <select
                aria-label="Сценарий мультиэкранного холста"
                title="Выбрать готовый набор экранов"
                onChange={(e) => {
                  if (e.target.value) handleApplyPreset(e.target.value);
                }}
                defaultValue=""
                className={`h-7 text-[11px] font-medium px-2 rounded-md border cursor-pointer ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-300'
                    : 'bg-white border-zinc-300 text-zinc-800'
                }`}
              >
                <option value="" disabled>
                  Пресет...
                </option>
                {WORKSPACE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              {/* Bezel Toggle (Icon-only) */}
              <button
                type="button"
                onClick={() => setShowBezel((b) => !b)}
                title={showBezel ? 'Скрыть рамку корпуса телефона' : 'Показать рамку корпуса телефона'}
                aria-label="Переключить рамку корпуса"
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                  !showBezel
                    ? isDark
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-zinc-900 text-white border-zinc-900'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>

              {/* Safe Area & Box Model Ruler Toggle (Icon-only) */}
              <button
                type="button"
                onClick={() => {
                  setShowSafeArea((s) => !s);
                  setShowBoxModel((b) => !b);
                }}
                title="Показать или скрыть зоны Safe Area и отступы Box Model (Alt+B)"
                aria-label="Safe Area и Box Model"
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                  showSafeArea
                    ? isDark
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-zinc-900 text-white border-zinc-900'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
              </button>

              {/* LAN / Mobile QR Modal (Icon-only) */}
              <button
                type="button"
                onClick={() => setShowTunnelModal(true)}
                title="Открыть QR-код и ссылки для тестирования на смартфоне"
                aria-label="Открыть на смартфоне"
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
              </button>

              {/* Divider */}
              <div className={`h-4 w-px mx-0.5 ${isDark ? 'bg-[#26262B]' : 'bg-zinc-200'}`} />

              {/* Fit Zoom + Compact Slider */}
              <button
                type="button"
                onClick={handleFitZoom}
                title="Вписать экраны по высоте окна (Alt+0)"
                aria-label="Автомасштаб"
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>

              <div
                title="Масштаб холста предпросмотра"
                className="hidden lg:flex items-center gap-1.5 px-1"
              >
                <input
                  type="range"
                  aria-label="Масштаб холста"
                  min={40}
                  max={120}
                  step={5}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(parseInt(e.target.value, 10) / 100)}
                  className="w-16 accent-zinc-200 cursor-pointer"
                />
                <span className="font-mono text-[11px] tabular-nums text-zinc-400 w-9 text-right">
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              <button
                type="button"
                aria-label="Перезагрузить экраны предпросмотра"
                title="Перезагрузить все открытые экраны"
                onClick={() => {
                  iframesRef.current.forEach((iframe) => {
                    try {
                      iframe.src = iframe.src;
                    } catch {}
                  });
                }}
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              {/* Divider */}
              <div className={`h-4 w-px mx-0.5 ${isDark ? 'bg-[#26262B]' : 'bg-zinc-200'}`} />

              {/* DOCK SIDE SWITCHER: LEFT vs RIGHT */}
              <button
                type="button"
                data-testid="dock-position-toggle"
                onClick={() => setDockPosition((p) => (p === 'left' ? 'right' : 'left'))}
                title={
                  dockPosition === 'left'
                    ? 'Переместить боковую панель вправо от макета'
                    : 'Переместить боковую панель влево от макета'
                }
                aria-label={
                  dockPosition === 'left'
                    ? 'Расположить панель справа'
                    : 'Расположить панель слева'
                }
                className={`h-7 px-2 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {dockPosition === 'left' ? (
                  <PanelRight className="w-3.5 h-3.5" />
                ) : (
                  <PanelLeft className="w-3.5 h-3.5" />
                )}
                <span className="hidden xl:inline">
                  {dockPosition === 'left' ? 'Вправо' : 'Влево'}
                </span>
              </button>

              {/* Theme Toggle Icon (Sun / Moon) */}
              <button
                type="button"
                data-testid="header-theme-toggle"
                onClick={() => setThemeKey(isDark ? 'daylight' : 'obsidian')}
                title={isDark ? 'Переключить на светлую тему (Alt+T)' : 'Переключить на тёмную тему (Alt+T)'}
                aria-label="Переключить тему оформления"
                className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:text-white hover:bg-zinc-800'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100'
                }`}
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

          {/* Command Palette Trigger */}
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            title="Открыть командную палитру (Ctrl+K)"
            aria-label="Команды (Ctrl+K)"
            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
              isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                : 'bg-zinc-900 border-zinc-900 text-white hover:bg-zinc-800'
            }`}
          >
            <Command className="w-3 h-3" />
            <span className="font-mono text-[10px]">⌘K</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE CONTENT: VIEWPORT-LOCKED WITH INDEPENDENT DOCK SCROLL */}
      <main className="flex-1 min-h-0 flex overflow-hidden">
        <div
          data-dock-side={dockPosition}
            className={`flex-1 min-h-0 flex w-full overflow-hidden ${
              dockPosition === 'right' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* SIDEBAR DOCK: INDEPENDENT VERTICAL SCROLL ON OUTER CONTAINER */}
            <aside
              data-testid="workbench-dock"
              style={{ width: `${dockWidth}px` }}
              className={`h-full overflow-y-auto shrink-0 p-3 flex flex-col gap-3 select-none ${
                dockPosition === 'left' ? 'border-r' : 'border-l'
              } ${currentTheme.surfaceBg} ${currentTheme.borderClass}`}
            >
              {/* DOCK HEADER: SECTION TABS (Слои | Очередь | Аудит | Код | Настройки) + SIDE TOGGLE */}
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className={`flex-1 flex items-center gap-1 p-0.5 rounded-lg border overflow-hidden ${
                    isDark ? 'bg-[#0E0E11] border-[#27272A]' : 'bg-zinc-100 border-zinc-200'
                  }`}
                >
                  {[
                    {
                      id: 'layers' as const,
                      label: 'Слои',
                      title: 'Слои — Инспектор DOM и конструктор слоёв (Alt+I)',
                      icon: Layers,
                    },
                    {
                      id: 'queue' as const,
                      label: 'Очередь',
                      count: agentQueue.length,
                      title: `Очередь задач агента (${agentQueue.length})`,
                      icon: ListTodo,
                    },
                    {
                      id: 'audit' as const,
                      label: 'Аудит',
                      count: auditIssues.length,
                      title: `Аудит вёрстки и Telegram (${auditIssues.length})`,
                      icon: ShieldCheck,
                    },
                    {
                      id: 'code' as const,
                      label: 'Код',
                      title: 'Готовые модули кода и архитектурные чертежи',
                      icon: Code2,
                    },
                    {
                      id: 'settings' as const,
                      label: 'Настройки',
                      title: 'Настройки — Горячие клавиши и сценарии экранов',
                      icon: Settings,
                    },
                  ].map((tab) => {
                    const isActive = dockTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        data-testid={`dock-tab-${tab.id}`}
                        title={tab.title}
                        onClick={() => {
                          setDockTab(tab.id);
                          if (tab.id === 'audit') setTimeout(handleRunLayoutAudit, 80);
                        }}
                        className={`h-7 rounded-md text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 whitespace-nowrap ${
                          isActive
                            ? isDark
                              ? 'flex-1 bg-zinc-200 text-zinc-950 font-semibold px-2.5 shadow-xs'
                              : 'flex-1 bg-white text-zinc-950 font-semibold px-2.5 shadow-xs'
                            : isDark
                            ? 'px-2 text-zinc-400 hover:text-zinc-100 hover:bg-[#18181C]'
                            : 'px-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60'
                        }`}
                      >
                        <tab.icon className="w-3.5 h-3.5 shrink-0" />
                        {isActive && (
                          <span className="truncate">{tab.label}</span>
                        )}
                        {tab.count !== undefined && tab.count > 0 && (
                          <span
                            className={`text-[9px] font-mono tabular-nums px-1 py-0.2 rounded-full ${
                              isActive
                                ? 'bg-zinc-950/15 text-zinc-950 font-bold'
                                : 'bg-[#B833FF]/20 text-[#B833FF] font-bold'
                            }`}
                          >
                            {tab.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setDockPosition((p) => (p === 'left' ? 'right' : 'left'))}
                  title={
                    dockPosition === 'left'
                      ? 'Перенести панель на правую сторону экрана'
                      : 'Перенести панель на левую сторону экрана'
                  }
                  aria-label="Сменить сторону панели"
                  className={`h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    isDark
                      ? 'bg-[#0E0E11] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {dockPosition === 'left' ? (
                    <PanelRight className="w-3.5 h-3.5" />
                  ) : (
                    <PanelLeft className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {dockTab === 'layers' && (
                <LayerBuilderDock
                  layers={designLayers}
                  activeLayerId={activeBuilderLayerId}
                  checkedLayerIds={checkedLayerIds}
                  snapGridSize={snapGridSize}
                  operations={builderOps}
                  isDark={isDark}
                  enqueuedSuccess={builderEnqueuedToast}
                  slotCount={slots.length}
                  liveMultiScreenSync={liveMultiScreenSync}
                  canvasEyedropperTarget={canvasEyedropperTarget}
                  onToggleCanvasEyedropper={(target) =>
                    setCanvasEyedropperTarget((prev) => (prev === target ? null : target))
                  }
                  onToggleMultiScreenSync={() => setLiveMultiScreenSync((v) => !v)}
                  onEnableAdaptiveTwoScreens={handleEnableAdaptiveTwoScreens}
                  onSelectLayer={(id) => {
                    setActiveBuilderLayerId(id);
                    const doc = getPrimaryIframeDoc();
                    if (doc) {
                      const el = findDomElementByLayerId(doc, id);
                      if (el) selectDomElement(el, doc);
                    }
                  }}
                  onToggleCheckLayer={(id) =>
                    setCheckedLayerIds((prev) =>
                      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
                    )
                  }
                  onToggleSnapGrid={() => setSnapGridSize((prev) => (prev > 1 ? 1 : 8))}
                  onRefreshLayers={() => refreshDesignLayers()}
                  onTransformLayer={handleBuilderTransformLayer}
                  onUpdateLayerText={handleBuilderUpdateText}
                  onUpdateLayerTextColor={handleBuilderUpdateTextColor}
                  onUpdateLayerBgColor={handleBuilderUpdateBgColor}
                  onUpdateLayerIcon={handleBuilderUpdateIcon}
                  onReorderLayer={handleBuilderReorderLayer}
                  onGroupCheckedLayers={handleBuilderGroupLayers}
                  onUngroupLayer={handleBuilderUngroupLayer}
                  onDuplicateLayer={handleBuilderDuplicateLayer}
                  onToggleVisibility={(id) => {
                    const docs = getTargetIframeDocs();
                    docs.forEach((d) => toggleDomLayerVisibility(d, id));
                    updateHiddenLayersCount();
                    refreshDesignLayers(id);
                  }}
                  onToggleLock={(id) => {
                    const docs = getTargetIframeDocs();
                    docs.forEach((d) => toggleDomLayerLock(d, id));
                    refreshDesignLayers(id);
                  }}
                  onResetAll={() => {
                    const docs = getTargetIframeDocs();
                    docs.forEach((d) => resetAllDomLayerTransforms(d));
                    setBuilderOps([]);
                    refreshDesignLayers();
                  }}
                  onEnqueueBuilderChanges={handleEnqueueBuilderLayer}
                  isInspectMode={isInspectMode}
                  onToggleInspectMode={() => setIsInspectMode((prev) => !prev)}
                  onQuickSelectComponent={handleQuickSelectComponent}
                  selectedElement={selectedElement}
                  onNavigateParent={() => handleNavigateHierarchy('parent')}
                  onNavigateChild={() => handleNavigateHierarchy('child')}
                  onToggleHideCurrentLayer={handleToggleHideLayer}
                  hiddenLayersCount={hiddenCount}
                  onRestoreHiddenLayers={handleRestoreHiddenLayers}
                  selectedDirectiveId={selectedDirectiveId}
                  onChangeDirectiveId={setSelectedDirectiveId}
                  noteText={noteText}
                  onChangeNoteText={setNoteText}
                  onCopySinglePrompt={handleCopySingleElementPrompt}
                  copiedSingle={copiedSingle}
                />
              )}
              {dockTab === 'queue' && (
                <div className="overflow-y-auto">
                  <AgentQueueView
                    queue={agentQueue}
                    isDark={isDark}
                    workspaceMeta={workspaceMeta}
                    onUpdateItem={(id, patch) =>
                      setAgentQueue((prev) =>
                        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
                      )
                    }
                    onRemoveItem={(id) => setAgentQueue((prev) => prev.filter((item) => item.id !== id))}
                    onClearQueue={() => setAgentQueue([])}
                    onAddSampleTask={() => {
                      const nextPin = agentQueue.length + 1;
                      setAgentQueue((prev) => [
                        ...prev,
                        {
                          id: `sample-${Date.now()}`,
                          pinNumber: nextPin,
                          createdAt: new Date().toLocaleTimeString('ru-RU'),
                          slotDeviceName: 'Galaxy S24 Ultra',
                          priority: 'high',
                          directiveId: 'safe-area',
                          note: 'Увеличить нижний отступ навигации с учётом Safe Area на Android и iOS',
                          element: {
                            tag: 'nav',
                            className: 'fixed bottom-0 inset-x-0 h-16 bg-[#151421]/95',
                            textSnippet: 'Лента · Витрина · Создать · Профиль',
                            rect: { top: 788, left: 0, width: 393, height: 64 },
                            selector: 'div > nav.fixed.bottom-0',
                            componentName: 'BottomTabNav',
                            sourceFile: 'components/demo/DemoApp.tsx',
                            sourceLine: 500,
                          },
                          diffs: [
                            {
                              property: 'Высота',
                              before: '64px',
                              after: '76px',
                              tailwindSuggestion: 'h-[76px] pb-safe',
                            },
                          ],
                        },
                      ]);
                    }}
                  />
                </div>
              )}

              {dockTab === 'audit' && (
                <div className="overflow-y-auto">
                  <LayoutAuditView
                    issues={auditIssues}
                    isDark={isDark}
                    tgEnv={tgEnv}
                    hapticLogs={hapticLogs}
                    onUpdateTgEnv={updateTgEnv}
                    onRunAudit={handleRunLayoutAudit}
                    onEnqueueIssue={(issue) => {
                      const nextPin =
                        agentQueue.length > 0 ? Math.max(...agentQueue.map((i) => i.pinNumber)) + 1 : 1;
                      setAgentQueue((prev) => [
                        ...prev,
                        {
                          id: `audit-task-${Date.now()}`,
                          pinNumber: nextPin,
                          createdAt: new Date().toLocaleTimeString('ru-RU'),
                          slotDeviceName: 'Layout Linter',
                          priority: issue.severity === 'error' ? 'high' : 'normal',
                          directiveId: issue.category === 'overflow-x' ? 'responsive-320' : 'safe-area',
                          note: `${issue.title}: ${issue.suggestedFix}`,
                          element: {
                            tag: 'div',
                            className: '',
                            textSnippet: issue.description,
                            rect: issue.rect,
                            selector: issue.selector,
                            componentName: issue.componentName,
                            sourceFile: issue.sourceFile,
                            sourceLine: issue.sourceLine,
                          },
                          diffs: [],
                        },
                      ]);
                      setDockTab('queue');
                    }}
                    onClearHapticLogs={() => setHapticLogs([])}
                  />
                </div>
              )}

              {dockTab === 'code' && (
                <div className="overflow-y-auto">
                  <CodeBlueprintView isDark={isDark} />
                </div>
              )}

              {dockTab === 'settings' && (
                <div className="overflow-y-auto">
                  <HotkeysThemeView
                    hotkeys={hotkeys}
                    onUpdateHotkey={(id, newCombo) =>
                      setHotkeys((prev) =>
                        prev.map((h) => (h.id === id ? { ...h, combo: newCombo } : h))
                      )
                    }
                    onResetHotkeys={() => setHotkeys(DEFAULT_HOTKEYS)}
                    onApplyPreset={handleApplyPreset}
                    isDark={isDark}
                  />
                </div>
              )}
            </aside>

            {/* INTERACTIVE DOCK WIDTH RESIZE SPLITTER */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Изменить ширину боковой панели"
              data-testid="dock-resize-handle"
              title="Тяните влево или вправо для изменения ширины панели (двойной клик — сброс 350px)"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingDock(true);
              }}
              onDoubleClick={() => setDockWidth(350)}
              className={`w-1.5 h-full shrink-0 cursor-col-resize flex items-center justify-center group transition-colors ${
                isResizingDock
                  ? 'bg-zinc-400'
                  : isDark
                  ? 'bg-transparent hover:bg-zinc-700/70'
                  : 'bg-transparent hover:bg-zinc-300'
              }`}
            >
              <div
                className={`w-0.5 h-10 rounded-full transition-colors ${
                  isResizingDock
                    ? 'bg-white'
                    : 'bg-zinc-600/40 group-hover:bg-zinc-300'
                }`}
              />
            </div>

            {/* PHONE MOCKUP CANVAS: FIXED IN VIEWPORT, NEVER SCROLLS WHEN DOCK SCROLLS */}
            <div
              ref={canvasContainerRef}
              className={`flex-1 min-w-0 h-full overflow-auto flex items-start justify-center p-4 ${
                isResizingDock ? 'pointer-events-none select-none' : ''
              }`}
            >
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
                      showSafeArea={showSafeArea}
                      canRemove={slots.length > 1}
                      hapticTriggered={hapticTriggered}
                      allDevices={PREVIEW_DEVICES}
                      pins={agentQueue}
                      iframeRef={(el) => handleIframeRef(slot.id, el)}
                      onIframeLoad={() => refreshDesignLayers()}
                      onRotate={() =>
                        setSlots((prev) =>
                          prev.map((s) => (s.id === slot.id ? { ...s, rotated: !s.rotated } : s))
                        )
                      }
                      onChangeDevice={(newKey) =>
                        setSlots((prev) =>
                          prev.map((s) => (s.id === slot.id ? { ...s, deviceKey: newKey } : s))
                        )
                      }
                      onRemove={() => setSlots((prev) => prev.filter((s) => s.id !== slot.id))}
                      onCaptureScreenshot={handleCaptureSlotScreenshot}
                      onSelectPin={() => setDockTab('queue')}
                      isDark={isDark}
                      iframeSrc={targetUrl}
                      canvasEyedropperActive={Boolean(canvasEyedropperTarget)}
                      hoveredEyedropperHex={hoveredEyedropperHex}
                      onCancelEyedropper={() => setCanvasEyedropperTarget(null)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
      </main>

      {/* MODALS: COMMAND PALETTE (Ctrl+K), MOBILE TUNNEL & VISUAL-TECHNICAL SCREENSHOT */}
      <TechnicalScreenshotModal
        screenshot={latestScreenshot}
        isDark={isDark}
        onClose={() => setLatestScreenshot(null)}
        onEnqueueScreenshot={handleEnqueueScreenshot}
      />

      <CommandPaletteModal
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        isDark={isDark}
        onToggleInspect={() => {
          setActiveSection('canvas');
          setIsInspectMode((prev) => !prev);
        }}
        onFitZoom={handleFitZoom}
        onToggleBoxModel={() => {
          setShowBoxModel((b) => !b);
          setShowSafeArea((s) => !s);
        }}
        onCopyBatchPrompt={() => {
          const md = buildConsolidatedAgentPrompt(agentQueue, workspaceMeta);
          navigator.clipboard.writeText(md);
        }}
        onRunAudit={() => {
          setActiveSection('audit');
          setTimeout(handleRunLayoutAudit, 80);
        }}
        onSelectPreset={handleApplyPreset}
        onSelectTheme={setThemeKey}
      />

      <MobileTunnelModal
        open={showTunnelModal}
        onClose={() => setShowTunnelModal(false)}
        isDark={isDark}
        localWifiUrl={lanInfo.localWifiUrl}
        publicAppUrl={lanInfo.publicAppUrl}
      />
    </div>
  );
}
