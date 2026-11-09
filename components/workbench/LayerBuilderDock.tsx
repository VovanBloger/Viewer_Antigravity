'use client';

import React, { useState } from 'react';
import {
  FolderPlus,
  FolderMinus,
  ArrowUp,
  ArrowDown,
  CopyPlus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  RotateCcw,
  RefreshCw,
  Grid,
  Plus,
  Check,
  Folder,
  Box,
  Type,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Search,
  MonitorSmartphone,
  Code2,
  ArrowLeftRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  StretchHorizontal,
  ChevronsUpDown,
  Crosshair,
  FileCode,
  Copy,
  Sliders,
} from 'lucide-react';
import {
  DesignLayerNode,
  DesignLayerTransform,
  LayerNodeKind,
  BuilderOperationRecord,
  ResponsiveSizingUnit,
  ResponsiveLayoutPreset,
  LayerBoxAlign,
  LayerContentAlign,
  BUILDER_ICON_PRESETS,
  formatLayerBuilderDiff,
  convertLayerSizingUnit,
  computeResponsiveWidthPercent,
  computeResponsiveOffsetPercent,
} from '@/lib/layer-builder';
import {
  ElementInfo,
  SMART_AGENT_DIRECTIVES,
  buildIdeDeepLink,
} from '@/lib/antigravity-core';
import { ColorPickerField } from './ColorPickerField';

interface LayerBuilderDockProps {
  layers: DesignLayerNode[];
  activeLayerId: string | null;
  checkedLayerIds: string[];
  snapGridSize: number;
  operations: BuilderOperationRecord[];
  isDark: boolean;
  enqueuedSuccess: boolean;
  slotCount: number;
  liveMultiScreenSync: boolean;
  canvasEyedropperTarget: 'bg' | 'text' | 'icon' | null;
  onToggleCanvasEyedropper: (target: 'bg' | 'text' | 'icon') => void;
  onToggleMultiScreenSync: () => void;
  onEnableAdaptiveTwoScreens: () => void;
  onSelectLayer: (layerId: string) => void;
  onToggleCheckLayer: (layerId: string) => void;
  onToggleSnapGrid: () => void;
  onRefreshLayers: () => void;
  onTransformLayer: (
    layerId: string,
    patch: Partial<DesignLayerTransform>,
    opSummary: string
  ) => void;
  onUpdateLayerText: (layerId: string, newText: string) => void;
  onUpdateLayerTextColor: (layerId: string, colorHex: string) => void;
  onUpdateLayerBgColor?: (layerId: string, colorHex: string) => void;
  onUpdateLayerIcon: (
    layerId: string,
    options: { presetId?: string; customSvg?: string; iconColor?: string },
    summary: string
  ) => void;
  onReorderLayer: (layerId: string, direction: 'up' | 'down') => void;
  onGroupCheckedLayers: (customIds?: string[]) => void;
  onUngroupLayer: (groupLayerId: string) => void;
  onDuplicateLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onResetAll: () => void;
  onEnqueueBuilderChanges: (layer: DesignLayerNode) => void;

  // Unified Inspector Props
  isInspectMode?: boolean;
  onToggleInspectMode?: () => void;
  onQuickSelectComponent?: (componentName: string) => void;
  selectedElement?: ElementInfo | null;
  onNavigateParent?: () => void;
  onNavigateChild?: () => void;
  onToggleHideCurrentLayer?: () => void;
  hiddenLayersCount?: number;
  onRestoreHiddenLayers?: () => void;
  selectedDirectiveId?: string;
  onChangeDirectiveId?: (id: string) => void;
  noteText?: string;
  onChangeNoteText?: (text: string) => void;
  onCopySinglePrompt?: () => void;
  copiedSingle?: boolean;
}

type DockSectionKey =
  | 'layers'
  | 'geometry'
  | 'style'
  | 'text'
  | 'icon'
  | 'children'
  | 'multiscreen'
  | 'agent'
  | 'diff';

export function LayerBuilderDock({
  layers,
  activeLayerId,
  checkedLayerIds,
  snapGridSize,
  operations,
  isDark,
  enqueuedSuccess,
  slotCount,
  liveMultiScreenSync,
  canvasEyedropperTarget,
  onToggleCanvasEyedropper,
  onToggleMultiScreenSync,
  onEnableAdaptiveTwoScreens,
  onSelectLayer,
  onToggleCheckLayer,
  onToggleSnapGrid,
  onRefreshLayers,
  onTransformLayer,
  onUpdateLayerText,
  onUpdateLayerTextColor,
  onUpdateLayerBgColor,
  onUpdateLayerIcon,
  onReorderLayer,
  onGroupCheckedLayers,
  onUngroupLayer,
  onDuplicateLayer,
  onToggleVisibility,
  onToggleLock,
  onResetAll,
  onEnqueueBuilderChanges,
  isInspectMode = false,
  onToggleInspectMode,
  onQuickSelectComponent,
  selectedElement,
  onNavigateParent,
  onNavigateChild,
  onToggleHideCurrentLayer,
  hiddenLayersCount = 0,
  onRestoreHiddenLayers,
  selectedDirectiveId = 'responsive-320',
  onChangeDirectiveId,
  noteText = '',
  onChangeNoteText,
  onCopySinglePrompt,
  copiedSingle = false,
}: LayerBuilderDockProps) {
  const [treeFilter, setTreeFilter] = useState('');
  // Tree nodes start collapsed by default
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [customSvgInput, setCustomSvgInput] = useState('');
  const [showCustomSvgBox, setShowCustomSvgBox] = useState(false);

  // Accordion sections: layers, geometry, style and agent are open by default for selected elements
  const [openSections, setOpenSections] = useState<Record<DockSectionKey, boolean>>({
    layers: true,
    geometry: true,
    style: true,
    text: true,
    icon: false,
    children: false,
    multiscreen: false,
    agent: true,
    diff: false,
  });

  const toggleSection = (key: DockSectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeLayer = React.useMemo(() => {
    if (activeLayerId) {
      const found = layers.find((l) => l.id === activeLayerId);
      if (found) return found;
    }
    if (selectedElement) {
      const matched = layers.find(
        (l) =>
          (selectedElement.id && l.id === selectedElement.id) ||
          (selectedElement.componentName && l.name === selectedElement.componentName) ||
          (selectedElement.textSnippet && l.textValue?.includes(selectedElement.textSnippet.slice(0, 20)))
      );
      if (matched) return matched;

      // Synthesize a full DesignLayerNode from selectedElement so the panel always works!
      const synth: DesignLayerNode = {
        id: selectedElement.id || `layer-${selectedElement.componentName || selectedElement.tag}`,
        name: selectedElement.componentName || (selectedElement.textSnippet ? selectedElement.textSnippet.slice(0, 24) : `<${selectedElement.tag}>`),
        tag: selectedElement.tag,
        selector: selectedElement.selector,
        isGroup: false,
        visible: true,
        locked: false,
        nodeKind: (['h1', 'h2', 'h3', 'h4', 'p', 'span', 'label'].includes(selectedElement.tag)
          ? 'text'
          : selectedElement.tag === 'button'
          ? 'button'
          : selectedElement.tag === 'input'
          ? 'input'
          : selectedElement.tag === 'svg'
          ? 'icon'
          : 'container') as LayerNodeKind,
        parentId: null,
        childIds: [],
        depth: 0,
        sourceFile: selectedElement.sourceFile,
        sourceLine: selectedElement.sourceLine,
        initialRect: {
          x: selectedElement.rect.left,
          y: selectedElement.rect.top,
          width: selectedElement.rect.width,
          height: selectedElement.rect.height,
        },
        currentRect: {
          x: selectedElement.rect.left,
          y: selectedElement.rect.top,
          width: selectedElement.rect.width,
          height: selectedElement.rect.height,
        },
        transform: {
          dx: 0,
          dy: 0,
          width: selectedElement.rect.width,
          height: selectedElement.rect.height,
          zIndex: 0,
          orderIndex: 0,
          widthUnit: 'px',
          widthPercent: 100,
          heightUnit: 'px',
          offsetUnit: 'px',
          dxPercent: 0,
          responsivePreset: 'none',
          useFlowSpacing: false,
          boxAlign: 'none',
          contentAlign: 'none',
        },
        textValue: selectedElement.textSnippet || undefined,
        initialTextValue: selectedElement.textSnippet || undefined,
        hasSvgIcon: selectedElement.tag === 'svg',
      };
      return synth;
    }
    return layers[0] || null;
  }, [layers, activeLayerId, selectedElement]);
  const builderDiff = activeLayer ? formatLayerBuilderDiff(activeLayer, operations) : null;

  const ancestorLayers = React.useMemo(() => {
    if (!activeLayer) return [];
    const ancestors: DesignLayerNode[] = [];
    let cur = activeLayer;
    let safety = 0;
    while (cur.parentId && safety < 10) {
      const parent = layers.find((l) => l.id === cur.parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      cur = parent;
      safety++;
    }
    return ancestors;
  }, [activeLayer, layers]);

  const activeChildLayers = React.useMemo(() => {
    if (!activeLayer) return [];
    return layers.filter((l) => l.parentId === activeLayer.id);
  }, [layers, activeLayer]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAndExpand = (layerId: string) => {
    onSelectLayer(layerId);
    const target = layers.find((l) => l.id === layerId);
    if (!target) return;

    const toExpand = new Set<string>(expandedIds);
    if (target.childIds.length > 0) {
      toExpand.add(target.id);
    }
    let currParentId = target.parentId;
    while (currParentId) {
      toExpand.add(currParentId);
      const pNode = layers.find((l) => l.id === currParentId);
      currParentId = pNode?.parentId || null;
    }
    setExpandedIds(Array.from(toExpand));
  };

  const allContainerIds = React.useMemo(
    () => layers.filter((l) => l.childIds.length > 0).map((l) => l.id),
    [layers]
  );

  const visibleTreeLayers = React.useMemo(() => {
    const q = treeFilter.trim().toLowerCase();
    if (q) {
      return layers.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.textValue && l.textValue.toLowerCase().includes(q)) ||
          l.tag.toLowerCase().includes(q)
      );
    }

    const layerMap = new Map<string, DesignLayerNode>();
    layers.forEach((l) => layerMap.set(l.id, l));

    return layers.filter((l) => {
      if (!l.parentId) return true;
      let currPid: string | null = l.parentId;
      while (currPid) {
        if (!expandedIds.includes(currPid)) return false;
        const pNode = layerMap.get(currPid);
        currPid = pNode?.parentId || null;
      }
      return true;
    });
  }, [layers, treeFilter, expandedIds]);

  const currentUnit: ResponsiveSizingUnit = activeLayer?.transform.widthUnit || '%';
  const isPercentMode = currentUnit === '%';
  const currentPreset: ResponsiveLayoutPreset = activeLayer?.transform.responsivePreset || 'none';
  const currentHeightUnit = activeLayer?.transform.heightUnit || (isPercentMode ? 'auto' : 'px');
  const currentOffsetUnit = activeLayer?.transform.offsetUnit || (isPercentMode ? '%' : 'px');
  const currentBoxAlign: LayerBoxAlign = activeLayer?.transform.boxAlign || 'none';
  const currentContentAlign: LayerContentAlign = activeLayer?.transform.contentAlign || 'none';

  const handleSwitchUnitMode = (targetUnit: ResponsiveSizingUnit) => {
    if (!activeLayer) return;
    const patch = convertLayerSizingUnit(activeLayer, targetUnit);
    onTransformLayer(
      activeLayer.id,
      patch,
      `Переключение режима размеров ${activeLayer.name} на ${targetUnit}`
    );
  };

  const borderMuted = isDark ? 'border-[#26262B]' : 'border-zinc-200';
  const surfaceSubtle = isDark ? 'bg-[#18181C]' : 'bg-zinc-100';
  const inputClass = isDark
    ? 'bg-[#0E0E11] border-[#27272A] text-zinc-100 focus:border-zinc-400'
    : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-600';

  return (
    <div className="divide-y divide-[#26262B]">
      {/* UNIFIED INSPECTOR HEADER: CROSSHAIR + QUICK NODES */}
      <div className="pb-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="unified-inspect-toggle"
            onClick={onToggleInspectMode}
            title="Включить прицел выбора элемента на экране телефона (Alt+I)"
            aria-label="Выбрать элемент на макете"
            className={`w-full h-7 px-2.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              isInspectMode
                ? isDark
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'bg-zinc-900 text-white font-semibold shadow-xs'
                : isDark
                ? 'bg-[#18181C] border border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                : 'bg-zinc-100 border border-zinc-300 text-zinc-800 hover:bg-zinc-200'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{isInspectMode ? 'Кликните на макет' : 'Выбрать элемент'}</span>
          </button>
        </div>

        {/* Quick Component Chips */}
        {onQuickSelectComponent && (
          <div className="grid grid-cols-4 gap-1">
            {[
              { id: 'HeroBannerCard', label: 'Hero', tip: 'Выбрать главный баннер' },
              { id: 'FeatureCard_card-1', label: 'Карточка', tip: 'Выбрать первую карточку' },
              { id: 'SearchInputBar', label: 'Поиск', tip: 'Выбрать строку поиска' },
              { id: 'BottomTabNav', label: 'Таб-бар', tip: 'Выбрать нижнюю навигацию' },
            ].map((node) => (
              <button
                key={node.id}
                type="button"
                title={node.tip}
                onClick={() => onQuickSelectComponent(node.id)}
                className={`h-6 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                  selectedElement?.componentName === node.id || (activeLayer && activeLayer.name.includes(node.label))
                    ? isDark
                      ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                      : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {node.label}
              </button>
            ))}
          </div>
        )}

        {/* Selected Element / Layer Info Card */}
        {activeLayer ? (
          <div
            className={`p-2 rounded-lg border space-y-1.5 ${borderMuted} ${
              isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs font-semibold text-zinc-200">
                  &lt;{activeLayer.tag}&gt;
                </span>
                <span className="text-xs text-zinc-400 truncate">
                  {activeLayer.name}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeChildLayers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(activeLayer.id)}
                    title={`Внутри ${activeChildLayers.length} вложенных элементов. Нажмите, чтобы развернуть в дереве слоёв.`}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    ↳ {activeChildLayers.length}
                  </button>
                )}
                <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                  {activeLayer.currentRect.width}×{activeLayer.currentRect.height}
                </span>
              </div>
            </div>

            {/* BREADCRUMB PATH (Ancestors in tree) */}
            {ancestorLayers.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 overflow-x-auto whitespace-nowrap scrollbar-none py-0.5">
                {ancestorLayers.map((anc) => (
                  <React.Fragment key={anc.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectAndExpand(anc.id)}
                      title={`Перейти к предку: ${anc.name}`}
                      className="hover:text-zinc-200 hover:underline cursor-pointer truncate max-w-[80px]"
                    >
                      {anc.name}
                    </button>
                    <span className="text-zinc-600">›</span>
                  </React.Fragment>
                ))}
                <span className="text-zinc-300 font-semibold truncate max-w-[100px]">
                  {activeLayer.name}
                </span>
              </div>
            )}

            {activeLayer.sourceFile && (
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                <span className="text-zinc-500 truncate">
                  {activeLayer.sourceFile}
                  {activeLayer.sourceLine ? `:${activeLayer.sourceLine}` : ''}
                </span>
                <a
                  href={buildIdeDeepLink(
                    activeLayer.sourceFile,
                    activeLayer.sourceLine,
                    'antigravity'
                  )}
                  title="Открыть файл в редакторе на этой строке"
                  className="text-zinc-300 hover:text-white flex items-center gap-1 shrink-0"
                >
                  <FileCode className="w-3 h-3" />
                  <span>IDE</span>
                </a>
              </div>
            )}

            {(onNavigateParent || onNavigateChild || onToggleHideCurrentLayer) && (
              <div className="grid grid-cols-3 gap-1 pt-0.5">
                {onNavigateParent && (
                  <button
                    type="button"
                    title="Перейти к родительскому DOM-элементу"
                    onClick={onNavigateParent}
                    className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                      isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                        : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <ArrowUp className="w-3 h-3" />
                    <span>Родитель</span>
                  </button>
                )}
                {onNavigateChild && (
                  <button
                    type="button"
                    title="Перейти к первому дочернему элементу"
                    onClick={onNavigateChild}
                    className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                      isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                        : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <ArrowDown className="w-3 h-3" />
                    <span>Дочерний</span>
                  </button>
                )}
                {onToggleHideCurrentLayer && (
                  <button
                    type="button"
                    title="Временно скрыть этот элемент на макете"
                    onClick={onToggleHideCurrentLayer}
                    className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                      isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:text-rose-400'
                        : 'bg-white border-zinc-300 text-zinc-700 hover:text-rose-600'
                    }`}
                  >
                    <EyeOff className="w-3 h-3" />
                    <span>Скрыть</span>
                  </button>
                )}
              </div>
            )}

            {hiddenLayersCount > 0 && onRestoreHiddenLayers && (
              <button
                type="button"
                onClick={onRestoreHiddenLayers}
                title="Показать все временно скрытые элементы"
                className="w-full h-6 rounded border border-zinc-700 text-zinc-300 text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                <span>Показать скрытые ({hiddenLayersCount})</span>
              </button>
            )}
          </div>
        ) : (
          <div
            className={`p-2.5 rounded-lg border border-dashed text-center space-y-0.5 text-xs ${
              isDark
                ? 'border-[#27272A] bg-[#0E0E11]/40 text-zinc-400'
                : 'border-zinc-300 bg-zinc-50 text-zinc-600'
            }`}
          >
            <div className="text-[11px] font-medium">Элемент не выбран</div>
            <div className="text-[10px] text-zinc-500">
              Нажмите «Выбрать элемент» (Alt+I) или выберите слой в дереве
            </div>
          </div>
        )}
      </div>

      {/* COMPACT ICON ACTION BAR */}
      <div className="pb-2.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (checkedLayerIds.length >= 2) {
                onGroupCheckedLayers();
              } else {
                const defaultPair = layers
                  .filter(
                    (l) =>
                      l.name.startsWith('SearchInputBar') || l.name.startsWith('HeroBannerCard')
                  )
                  .map((l) => l.id);
                const pairToGroup =
                  defaultPair.length >= 2
                    ? defaultPair
                    : layers.slice(0, 2).map((l) => l.id);
                onGroupCheckedLayers(pairToGroup);
              }
            }}
            title={
              checkedLayerIds.length >= 2
                ? `Сгруппировать выбранные слои (${checkedLayerIds.length})`
                : 'Сгруппировать отмеченные слои в контейнер'
            }
            aria-label="Сгруппировать слои"
            className={`h-7 px-2 rounded-md border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
              checkedLayerIds.length >= 2
                ? isDark
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-semibold'
                  : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Группа{checkedLayerIds.length >= 2 ? ` · ${checkedLayerIds.length}` : ''}</span>
          </button>

          {activeLayer?.isGroup && (
            <button
              type="button"
              onClick={() => onUngroupLayer(activeLayer.id)}
              title="Разгруппировать выбранный контейнер"
              aria-label="Разгруппировать"
              className={`h-7 px-2 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                  : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <FolderMinus className="w-3.5 h-3.5" />
            </button>
          )}

          {activeLayer && (
            <button
              type="button"
              onClick={() => onDuplicateLayer(activeLayer.id)}
              title="Дублировать выбранный слой"
              aria-label="Дублировать"
              className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                isDark
                  ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                  : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <CopyPlus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleSnapGrid}
            title={
              snapGridSize > 1
                ? 'Привязка к сетке 8px включена (нажмите для шага 1px)'
                : 'Свободный шаг 1px (нажмите для привязки к сетке 8px)'
            }
            aria-label="Привязка к сетке"
            className={`h-7 px-2 rounded-md border text-[10px] font-mono font-medium flex items-center gap-1 cursor-pointer ${
              snapGridSize > 1
                ? isDark
                  ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                  : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                : isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                : 'bg-white border-zinc-300 text-zinc-600'
            }`}
          >
            <Grid className="w-3 h-3" />
            <span>{snapGridSize > 1 ? '8px' : '1px'}</span>
          </button>

          <button
            type="button"
            onClick={onRefreshLayers}
            aria-label="Обновить дерево слоёв"
            title="Обновить дерево DOM-слоёв"
            className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer ${
              isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                : 'bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onResetAll}
            aria-label="Сбросить все изменения слоёв"
            title="Сбросить все сдвиги и размеры к исходным"
            className={`h-7 w-7 rounded-md border flex items-center justify-center cursor-pointer ${
              isDark
                ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-rose-400'
                : 'bg-white border-zinc-300 text-zinc-600 hover:text-rose-600'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* SECTION 1: LAYER TREE (OPEN BY DEFAULT) */}
      <div className="py-2">
        <div className="flex items-center justify-between h-7 mb-1.5">
          <button
            type="button"
            onClick={() => toggleSection('layers')}
            title="Свернуть или развернуть дерево слоёв"
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none"
          >
            {openSections.layers ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>Слои</span>
            <span className="text-[11px] font-mono text-zinc-500 font-normal">
              {layers.length}
            </span>
          </button>

          {openSections.layers && (
            <button
              type="button"
              onClick={() =>
                setExpandedIds((prev) => (prev.length > 0 ? [] : allContainerIds))
              }
              title={
                expandedIds.length > 0
                  ? 'Свернуть все вложенные ветки дерева'
                  : 'Развернуть все вложенные ветки дерева'
              }
              aria-label={expandedIds.length > 0 ? 'Свернуть все' : 'Развернуть все'}
              className={`h-6 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <ChevronsUpDown className="w-3 h-3" />
              <span>{expandedIds.length > 0 ? 'Свернуть все' : 'Развернуть все'}</span>
            </button>
          )}
        </div>

        {openSections.layers && (
          <div className={`rounded-lg border overflow-hidden ${borderMuted}`}>
            {/* Minimal Search Input */}
            <div
              className={`px-2 py-1.5 border-b flex items-center gap-1.5 ${borderMuted} ${
                isDark ? 'bg-[#0E0E11]' : 'bg-zinc-50'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                placeholder="Поиск слоя..."
                aria-label="Поиск по дереву слоёв"
                className={`w-full text-[11px] bg-transparent focus:outline-none ${
                  isDark
                    ? 'text-zinc-100 placeholder:text-zinc-500'
                    : 'text-zinc-900 placeholder:text-zinc-400'
                }`}
              />
              {treeFilter && (
                <button
                  type="button"
                  onClick={() => setTreeFilter('')}
                  title="Очистить поиск"
                  className="text-[10px] text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Tree Rows */}
            <div
              data-testid="design-layer-tree"
              className={`max-h-56 overflow-y-auto divide-y ${
                isDark ? 'divide-[#1F1F24] bg-[#101014]' : 'divide-zinc-100 bg-white'
              }`}
            >
              {visibleTreeLayers.map((layer) => {
                const isSelected = layer.id === activeLayer?.id;
                const isChecked = checkedLayerIds.includes(layer.id);
                const hasChildren = layer.childIds.length > 0;
                const isExpanded = expandedIds.includes(layer.id);
                const hasDelta =
                  layer.transform.dx !== 0 ||
                  layer.transform.dy !== 0 ||
                  (layer.transform.boxAlign && layer.transform.boxAlign !== 'none') ||
                  (layer.transform.contentAlign && layer.transform.contentAlign !== 'none') ||
                  Math.abs(layer.transform.width - layer.initialRect.width) > 1 ||
                  Math.abs(layer.transform.height - layer.initialRect.height) > 1 ||
                  (layer.textValue !== undefined &&
                    layer.initialTextValue !== undefined &&
                    layer.textValue !== layer.initialTextValue) ||
                  Boolean(layer.iconPresetId || layer.customSvgCode);

                return (
                  <div
                    key={layer.id}
                    style={{ paddingLeft: `${6 + layer.depth * 12}px` }}
                    className={`group pr-1.5 py-1 flex items-center justify-between gap-1 text-xs transition-colors ${
                      isSelected
                        ? isDark
                          ? 'bg-zinc-800 text-white font-medium'
                          : 'bg-zinc-200/80 text-zinc-950 font-semibold'
                        : isDark
                        ? 'hover:bg-zinc-900 text-zinc-300'
                        : 'hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(layer.id)}
                          aria-label={
                            isExpanded ? 'Свернуть вложенные слои' : 'Развернуть вложенные слои'
                          }
                          title={
                            isExpanded
                              ? 'Свернуть вложенные элементы'
                              : `Развернуть вложенные элементы (${layer.childIds.length})`
                          }
                          className="p-0.5 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}

                      {/* HIGH-CONTRAST CHECKBOX FOR DARK THEME */}
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-label={`Выбрать ${layer.name} для группировки`}
                        title="Отметить слой для группировки"
                        onClick={() => onToggleCheckLayer(layer.id)}
                        className={`w-3.5 h-3.5 rounded-[3px] border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                          isChecked
                            ? isDark
                              ? 'bg-white border-white text-zinc-950 shadow-xs'
                              : 'bg-zinc-900 border-zinc-900 text-white'
                            : isDark
                            ? 'bg-zinc-950 border-zinc-300 hover:border-white'
                            : 'bg-white border-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectLayer(layer.id);
                          if (hasChildren) {
                            toggleExpand(layer.id);
                          }
                        }}
                        title={
                          layer.textValue
                            ? `${layer.name} — Текст: «${layer.textValue}»`
                            : `Выбрать слой ${layer.name} (<${layer.tag}>)`
                        }
                        className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {layer.isGroup ? (
                          <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : layer.nodeKind === 'icon' || layer.hasSvgIcon ? (
                          <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : layer.nodeKind === 'text' ? (
                          <Type className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : (
                          <Box className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="font-mono text-[11px] truncate">{layer.name}</span>
                        {layer.textValue && layer.textValue !== layer.name && (
                          <span className="text-[10px] text-zinc-500 truncate max-w-[90px]">
                            {layer.textValue}
                          </span>
                        )}
                        {hasDelta && (
                          <span
                            title="Слой содержит изменения"
                            className="w-1.5 h-1.5 rounded-full bg-zinc-200 shrink-0"
                          />
                        )}
                      </button>
                    </div>

                    {/* Layer Row Quick Controls with Russian tooltips */}
                    <div className="flex items-center gap-0.5 shrink-0 opacity-75 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onReorderLayer(layer.id, 'up')}
                        aria-label={`Переместить слой ${layer.name} выше`}
                        title="Переместить слой выше"
                        className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorderLayer(layer.id, 'down')}
                        aria-label={`Переместить слой ${layer.name} ниже`}
                        title="Переместить слой ниже"
                        className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleVisibility(layer.id)}
                        aria-label={`Скрыть или показать слой ${layer.name}`}
                        title={layer.visible ? 'Скрыть слой' : 'Показать слой'}
                        className={`p-1 rounded hover:bg-white/10 cursor-pointer ${
                          layer.visible ? 'text-zinc-400 hover:text-zinc-100' : 'text-rose-400'
                        }`}
                      >
                        {layer.visible ? (
                          <Eye className="w-3 h-3" />
                        ) : (
                          <EyeOff className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLock(layer.id)}
                        aria-label={`Заблокировать слой ${layer.name}`}
                        title={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
                        className={`p-1 rounded hover:bg-white/10 cursor-pointer ${
                          layer.locked ? 'text-amber-400' : 'text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        {layer.locked ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ACTIVE LAYER SECTIONS */}
      {activeLayer && (
        <>
          {/* SECTION 2: GEOMETRY, ALIGNMENT (ICON-ONLY) & % vs PX SIZING (OPEN BY DEFAULT) */}
          <div className="py-2">
            <div className="flex items-center justify-between h-7">
              <button
                type="button"
                onClick={() => toggleSection('geometry')}
                title="Свернуть или развернуть настройки размеров и положения"
                className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none min-w-0"
              >
                {openSections.geometry ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                <span className="truncate">Размеры и положение</span>
              </button>

              {/* Compact % <-> px toggle button */}
              <button
                type="button"
                onClick={() => handleSwitchUnitMode(isPercentMode ? 'px' : '%')}
                title={
                  isPercentMode
                    ? 'Сейчас относительные проценты (%). Нажмите для переключения в пиксели (px)'
                    : 'Сейчас фиксированные пиксели (px). Нажмите для переключения в проценты (%)'
                }
                aria-label="Переключить единицы измерения"
                className={`h-6 px-2 rounded border text-[10px] font-mono font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  isPercentMode
                    ? isDark
                      ? 'bg-zinc-200 text-zinc-950 border-zinc-200'
                      : 'bg-zinc-900 text-white border-zinc-900'
                    : isDark
                    ? 'bg-[#18181C] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                    : 'bg-white border-zinc-300 text-zinc-700'
                }`}
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
                <span>{isPercentMode ? '%' : 'px'}</span>
              </button>
            </div>

            {openSections.geometry && (
              <div className="space-y-2.5 pt-2">
                {/* ICON-ONLY ALIGNMENT BAR: 1) Box Position in Container + 2) Content Alignment */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Group 1: Position inside container (Icon-only, tooltips on hover) */}
                  <div className="space-y-1">
                    <div
                      className="text-[10px] text-zinc-400 truncate"
                      title="Положение выбранного блока внутри родительского контейнера"
                    >
                      Положение
                    </div>
                    <div
                      className={`grid grid-cols-4 gap-0.5 p-0.5 rounded-md border ${borderMuted} ${surfaceSubtle}`}
                    >
                      {(
                        [
                          {
                            id: 'left',
                            label: 'Влево',
                            title: 'К левому краю контейнера (mr-auto ml-0 self-start)',
                            icon: AlignLeft,
                          },
                          {
                            id: 'center',
                            label: 'По центру',
                            title: 'По центру контейнера (mx-auto self-center)',
                            icon: AlignCenter,
                          },
                          {
                            id: 'right',
                            label: 'Вправо',
                            title: 'К правому краю контейнера (ml-auto mr-0 self-end)',
                            icon: AlignRight,
                          },
                          {
                            id: 'stretch',
                            label: 'На всю ширину',
                            title: 'Растянуть на всю ширину контейнера (w-full self-stretch)',
                            icon: StretchHorizontal,
                          },
                        ] as Array<{
                          id: LayerBoxAlign;
                          label: string;
                          title: string;
                          icon: React.ComponentType<{ className?: string }>;
                        }>
                      ).map((btn) => {
                        const Icon = btn.icon;
                        const isActive = currentBoxAlign === btn.id;
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            title={btn.title}
                            aria-label={`Положение в контейнере: ${btn.label}`}
                            onClick={() => {
                              const nextAlign: LayerBoxAlign = isActive ? 'none' : btn.id;
                              const patch: Partial<DesignLayerTransform> = {
                                boxAlign: nextAlign,
                                dx: 0,
                                dxPercent: 0,
                              };
                              if (nextAlign === 'stretch') {
                                patch.widthUnit = '%';
                                patch.widthPercent = 100;
                                patch.responsivePreset = 'w-full';
                              }
                              onTransformLayer(
                                activeLayer.id,
                                patch,
                                `Положение ${activeLayer.name} в контейнере: ${
                                  nextAlign === 'none' ? 'сброшено' : btn.label
                                }`
                              );
                            }}
                            className={`h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${
                              isActive
                                ? isDark
                                  ? 'bg-zinc-100 text-zinc-950 shadow-xs'
                                  : 'bg-zinc-900 text-white shadow-xs'
                                : isDark
                                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                                : 'text-zinc-600 hover:text-zinc-900 hover:bg-white'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Group 2: Inner Content Alignment (Icon-only, tooltips on hover) */}
                  <div className="space-y-1">
                    <div
                      className="text-[10px] text-zinc-400 truncate"
                      title="Выравнивание текста и дочерних элементов внутри слоя"
                    >
                      Контент
                    </div>
                    <div
                      className={`grid grid-cols-4 gap-0.5 p-0.5 rounded-md border ${borderMuted} ${surfaceSubtle}`}
                    >
                      {(
                        [
                          {
                            id: 'left',
                            label: 'Конт. влево',
                            title: 'Выровнять контент по левому краю (text-left justify-start)',
                            icon: AlignLeft,
                          },
                          {
                            id: 'center',
                            label: 'По центру',
                            title: 'Выровнять контент по центру (text-center justify-center)',
                            icon: AlignCenter,
                          },
                          {
                            id: 'right',
                            label: 'Вправо',
                            title: 'Выровнять контент по правому краю (text-right justify-end)',
                            icon: AlignRight,
                          },
                          {
                            id: 'between',
                            label: 'По краям',
                            title: 'Разнести элементы по краям (flex justify-between)',
                            icon: AlignJustify,
                          },
                        ] as Array<{
                          id: LayerContentAlign;
                          label: string;
                          title: string;
                          icon: React.ComponentType<{ className?: string }>;
                        }>
                      ).map((btn) => {
                        const Icon = btn.icon;
                        const isActive = currentContentAlign === btn.id;
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            title={btn.title}
                            aria-label={`Выравнивание внутри слоя: ${btn.label}`}
                            onClick={() => {
                              const nextContent: LayerContentAlign = isActive ? 'none' : btn.id;
                              onTransformLayer(
                                activeLayer.id,
                                { contentAlign: nextContent },
                                `Выравнивание контента внутри ${activeLayer.name}: ${
                                  nextContent === 'none' ? 'сброшено' : btn.label
                                }`
                              );
                            }}
                            className={`h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${
                              isActive
                                ? isDark
                                  ? 'bg-zinc-100 text-zinc-950 shadow-xs'
                                  : 'bg-zinc-900 text-white shadow-xs'
                                : isDark
                                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                                : 'text-zinc-600 hover:text-zinc-900 hover:bg-white'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Unit Mode Tabs: % | px | auto | rem | vw */}
                <div
                  className={`grid grid-cols-5 gap-0.5 p-0.5 rounded-md border ${borderMuted} ${surfaceSubtle}`}
                >
                  {(
                    [
                      { unit: '%', label: '%', tip: 'Относительная ширина в процентах от родителя' },
                      { unit: 'px', label: 'px', tip: 'Фиксированная ширина в пикселях' },
                      { unit: 'auto', label: 'auto', tip: 'Автоматический размер по содержимому' },
                      { unit: 'rem', label: 'rem', tip: 'Масштабируемые единицы rem' },
                      { unit: 'vw', label: 'vw', tip: 'Процент от ширины окна предпросмотра' },
                    ] as Array<{ unit: ResponsiveSizingUnit; label: string; tip: string }>
                  ).map((item) => (
                    <button
                      key={item.unit}
                      type="button"
                      title={item.tip}
                      onClick={() => handleSwitchUnitMode(item.unit)}
                      className={`h-6 rounded text-[10px] font-mono font-medium cursor-pointer transition-colors ${
                        currentUnit === item.unit
                          ? isDark
                            ? 'bg-zinc-100 text-zinc-950 font-semibold'
                            : 'bg-zinc-900 text-white font-semibold'
                          : isDark
                          ? 'text-zinc-400 hover:text-zinc-100'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* Quick Responsive Presets (Compact Single-Word Pills) */}
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { id: 'w-full', label: '100%', tip: 'На всю ширину контейнера (w-full)' },
                      { id: 'w-90-center', label: '90%', tip: '90% ширины по центру (w-[90%] mx-auto)' },
                      { id: 'w-1/2', label: '50%', tip: 'Половина ширины (w-1/2)' },
                      { id: 'flex-1', label: 'Flex', tip: 'Занять доступное место в ряду (flex-1)' },
                    ] as Array<{ id: ResponsiveLayoutPreset; label: string; tip: string }>
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.tip}
                      onClick={() =>
                        onTransformLayer(
                          activeLayer.id,
                          {
                            responsivePreset: preset.id,
                            widthUnit:
                              preset.id === 'w-full' ||
                              preset.id === 'w-90-center' ||
                              preset.id === 'w-1/2'
                                ? '%'
                                : 'auto',
                            widthPercent:
                              preset.id === 'w-full'
                                ? 100
                                : preset.id === 'w-90-center'
                                ? 90
                                : preset.id === 'w-1/2'
                                ? 50
                                : activeLayer.transform.widthPercent,
                            heightUnit: 'auto',
                          },
                          `Применён пресет ${preset.label} для ${activeLayer.name}`
                        )
                      }
                      className={`h-6 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                        currentPreset === preset.id
                          ? isDark
                            ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                            : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                          : isDark
                          ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-100'
                          : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Compact Figma-style W / H / Z and X / Y Grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  {/* W */}
                  <label
                    title={
                      isPercentMode
                        ? `Ширина в процентах (${activeLayer.transform.width}px)`
                        : 'Ширина элемента в пикселях'
                    }
                    className={`flex items-center h-7 px-2 rounded-md border font-mono text-xs ${inputClass}`}
                  >
                    <span className="text-[10px] text-zinc-500 mr-1.5 select-none">W</span>
                    <input
                      type="number"
                      aria-label="Ширина рамки слоя"
                      min={isPercentMode ? 5 : 20}
                      max={isPercentMode ? 100 : 1200}
                      value={
                        isPercentMode
                          ? activeLayer.transform.widthPercent ?? 100
                          : activeLayer.transform.width
                      }
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 20;
                        if (isPercentMode) {
                          const clampedPct = Math.max(5, Math.min(100, val));
                          const px = Math.round(
                            ((activeLayer.parentWidth || 360) * clampedPct) / 100
                          );
                          onTransformLayer(
                            activeLayer.id,
                            {
                              widthUnit: '%',
                              widthPercent: clampedPct,
                              width: px,
                              responsivePreset: 'none',
                            },
                            `Ширина ${activeLayer.name}: ${clampedPct}%`
                          );
                        } else {
                          const px = Math.max(20, val);
                          const pct = computeResponsiveWidthPercent(
                            px,
                            activeLayer.parentWidth || 360
                          );
                          onTransformLayer(
                            activeLayer.id,
                            {
                              widthUnit: 'px',
                              width: px,
                              widthPercent: pct,
                              responsivePreset: 'none',
                            },
                            `Ширина ${activeLayer.name}: ${px}px`
                          );
                        }
                      }}
                      className="w-full bg-transparent focus:outline-none tabular-nums text-right"
                    />
                    <span className="text-[9px] text-zinc-500 ml-0.5 select-none">
                      {isPercentMode ? '%' : 'px'}
                    </span>
                  </label>

                  {/* H */}
                  <div
                    title="Высота элемента (кликните по букве H для переключения Auto / px)"
                    className={`flex items-center h-7 px-2 rounded-md border font-mono text-xs ${inputClass}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onTransformLayer(
                          activeLayer.id,
                          { heightUnit: currentHeightUnit === 'auto' ? 'px' : 'auto' },
                          `Высота ${activeLayer.name}: ${
                            currentHeightUnit === 'auto' ? 'px' : 'auto'
                          }`
                        )
                      }
                      title="Переключить высоту между Auto и фиксированными пикселями"
                      className="text-[10px] text-zinc-500 hover:text-zinc-200 mr-1.5 cursor-pointer select-none"
                    >
                      H
                    </button>
                    <input
                      type="number"
                      aria-label="Высота рамки слоя"
                      min={16}
                      value={activeLayer.transform.height}
                      onChange={(e) =>
                        onTransformLayer(
                          activeLayer.id,
                          {
                            height: Math.max(16, parseInt(e.target.value, 10) || 16),
                            heightUnit: 'px',
                          },
                          `Высота ${activeLayer.name}: ${e.target.value}px`
                        )
                      }
                      className="w-full bg-transparent focus:outline-none tabular-nums text-right"
                    />
                    <span className="text-[9px] text-zinc-500 ml-0.5 select-none">
                      {currentHeightUnit === 'auto' ? 'au' : 'px'}
                    </span>
                  </div>

                  {/* Z */}
                  <label
                    title="Уровень наложения слоя по оси Z (z-index)"
                    className={`flex items-center h-7 px-2 rounded-md border font-mono text-xs ${inputClass}`}
                  >
                    <span className="text-[10px] text-zinc-500 mr-1.5 select-none">Z</span>
                    <input
                      type="number"
                      aria-label="Уровень слоя Z-Index"
                      value={activeLayer.transform.zIndex}
                      onChange={(e) =>
                        onTransformLayer(
                          activeLayer.id,
                          { zIndex: parseInt(e.target.value, 10) || 0 },
                          `Смена Z-Index слоя ${activeLayer.name}`
                        )
                      }
                      className="w-full bg-transparent focus:outline-none tabular-nums text-right"
                    />
                  </label>
                </div>

                {/* X / Y / Flow Mode */}
                <div className="grid grid-cols-3 gap-1.5">
                  <label
                    title={`Смещение по горизонтали (${currentOffsetUnit})`}
                    className={`flex items-center h-7 px-2 rounded-md border font-mono text-xs ${inputClass}`}
                  >
                    <span className="text-[10px] text-zinc-500 mr-1.5 select-none">X</span>
                    <input
                      type="number"
                      aria-label="Смещение по X"
                      value={
                        currentOffsetUnit === '%'
                          ? activeLayer.transform.dxPercent ?? 0
                          : activeLayer.transform.dx
                      }
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        const parentW = activeLayer.parentWidth || 360;
                        if (currentOffsetUnit === '%') {
                          const px = Math.round((parentW * val) / 100);
                          onTransformLayer(
                            activeLayer.id,
                            { dx: px, dxPercent: val, offsetUnit: '%' },
                            `Смещение X слоя ${activeLayer.name}: ${val}%`
                          );
                        } else {
                          const pct = computeResponsiveOffsetPercent(val, parentW);
                          onTransformLayer(
                            activeLayer.id,
                            { dx: val, dxPercent: pct, offsetUnit: 'px' },
                            `Смещение X слоя ${activeLayer.name}: ${val}px`
                          );
                        }
                      }}
                      className="w-full bg-transparent focus:outline-none tabular-nums text-right"
                    />
                    <span className="text-[9px] text-zinc-500 ml-0.5 select-none">
                      {currentOffsetUnit}
                    </span>
                  </label>

                  <label
                    title="Смещение по вертикали (px)"
                    className={`flex items-center h-7 px-2 rounded-md border font-mono text-xs ${inputClass}`}
                  >
                    <span className="text-[10px] text-zinc-500 mr-1.5 select-none">Y</span>
                    <input
                      type="number"
                      aria-label="Смещение по Y в пикселях"
                      value={activeLayer.transform.dy}
                      onChange={(e) =>
                        onTransformLayer(
                          activeLayer.id,
                          { dy: parseInt(e.target.value, 10) || 0 },
                          `Смещение Y слоя ${activeLayer.name}`
                        )
                      }
                      className="w-full bg-transparent focus:outline-none tabular-nums text-right"
                    />
                    <span className="text-[9px] text-zinc-500 ml-0.5 select-none">px</span>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      onTransformLayer(
                        activeLayer.id,
                        { useFlowSpacing: !activeLayer.transform.useFlowSpacing },
                        `Режим смещения: ${
                          !activeLayer.transform.useFlowSpacing ? 'Margin' : 'Translate'
                        }`
                      )
                    }
                    title={
                      activeLayer.transform.useFlowSpacing
                        ? 'Потоковый отступ Margin (нажмите для Translate3d)'
                        : 'Свободный сдвиг Translate3d (нажмите для Margin)'
                    }
                    className={`h-7 px-2 rounded-md border text-[10px] font-mono cursor-pointer transition-colors ${
                      activeLayer.transform.useFlowSpacing
                        ? isDark
                          ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold'
                          : 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                        : isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-400 hover:text-zinc-200'
                        : 'bg-white border-zinc-300 text-zinc-600'
                    }`}
                  >
                    {activeLayer.transform.useFlowSpacing ? 'Margin' : 'Translate'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SECTION: STYLE & COLORS (BACKGROUND & TEXT WITH COLOR PICKER & EYEDROPPER) */}
          <div className="py-2">
            <button
              type="button"
              onClick={() => toggleSection('style')}
              title="Настройка цвета фона и цвета текста выбранного слоя"
              className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5">
                {openSections.style ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>Цвета и стили</span>
              </div>
              <div className="flex items-center gap-1">
                {activeLayer.bgColor && (
                  <span
                    style={{ backgroundColor: activeLayer.bgColor }}
                    className="w-2.5 h-2.5 rounded-full border border-white/20"
                    title={`Фон: ${activeLayer.bgColor}`}
                  />
                )}
                {activeLayer.textColor && (
                  <span
                    style={{ backgroundColor: activeLayer.textColor }}
                    className="w-2.5 h-2.5 rounded-full border border-white/20"
                    title={`Текст: ${activeLayer.textColor}`}
                  />
                )}
              </div>
            </button>

            {openSections.style && (
              <div className="space-y-2 pt-1.5">
                <div className="flex items-center justify-between gap-2">
                  <ColorPickerField
                    id="layer-bg-color"
                    label="Цвет фона"
                    value={activeLayer.bgColor || '#181824'}
                    isDark={isDark}
                    isCanvasEyedropperActive={canvasEyedropperTarget === 'bg'}
                    onChange={(hex) => onUpdateLayerBgColor?.(activeLayer.id, hex)}
                    onToggleCanvasEyedropper={() => onToggleCanvasEyedropper('bg')}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <ColorPickerField
                    id="layer-text-color"
                    label="Цвет текста"
                    value={activeLayer.textColor || '#FFFFFF'}
                    isDark={isDark}
                    isCanvasEyedropperActive={canvasEyedropperTarget === 'text'}
                    onChange={(hex) => onUpdateLayerTextColor(activeLayer.id, hex)}
                    onToggleCanvasEyedropper={() => onToggleCanvasEyedropper('text')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: TEXT CONTENT & TEXT COLOR (COLLAPSED BY DEFAULT) */}
          {(activeLayer.textValue !== undefined ||
            activeLayer.nodeKind === 'text' ||
            activeLayer.nodeKind === 'button') && (
            <div className="py-2">
              <button
                type="button"
                onClick={() => toggleSection('text')}
                title="Редактировать текстовое содержимое и цвет текста выбранного элемента"
                className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
              >
                <div className="flex items-center gap-1.5">
                  {openSections.text ? (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>Текст</span>
                </div>
                {!openSections.text && activeLayer.textValue && (
                  <span className="text-[11px] font-normal text-zinc-500 truncate max-w-[140px]">
                    {activeLayer.textValue}
                  </span>
                )}
              </button>

              {openSections.text && (
                <div className="space-y-2 pt-1.5">
                  <input
                    type="text"
                    aria-label="Редактировать текст выбранного слоя"
                    value={activeLayer.textValue ?? ''}
                    onChange={(e) => onUpdateLayerText(activeLayer.id, e.target.value)}
                    placeholder="Текст элемента..."
                    className={`w-full h-7 px-2.5 rounded-md border text-xs ${inputClass}`}
                  />

                  <div className="flex items-center justify-between gap-2">
                    <ColorPickerField
                      id="text"
                      label="Цвет"
                      value={activeLayer.textColor || '#FFFFFF'}
                      isDark={isDark}
                      isCanvasEyedropperActive={canvasEyedropperTarget === 'text'}
                      onChange={(hex) => onUpdateLayerTextColor(activeLayer.id, hex)}
                      onToggleCanvasEyedropper={() => onToggleCanvasEyedropper('text')}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 4: SVG ICON REPLACEMENT (COLLAPSED BY DEFAULT) */}
          {activeLayer.hasSvgIcon && (
            <div className="py-2">
              <button
                type="button"
                onClick={() => toggleSection('icon')}
                title="Развернуть выбор пресетов иконок, цвет и замену SVG-кода"
                className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
              >
                <div className="flex items-center gap-1.5">
                  {openSections.icon ? (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>Замена иконки</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-500">SVG</span>
              </button>

              {openSections.icon && (
                <div className="space-y-2 pt-1.5">
                  <div className="grid grid-cols-6 gap-1">
                    {BUILDER_ICON_PRESETS.map((preset) => {
                      const isCurrent = activeLayer.iconPresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            onUpdateLayerIcon(
                              activeLayer.id,
                              { presetId: preset.id },
                              `Замена иконки в ${activeLayer.name} на ${preset.label} (<${preset.jsxName} />)`
                            )
                          }
                          title={`Заменить на иконку «${preset.label}» (<${preset.jsxName} />)`}
                          aria-label={`Иконка ${preset.label}`}
                          className={`h-7 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                            isCurrent
                              ? isDark
                                ? 'bg-zinc-100 border-zinc-100 text-zinc-950'
                                : 'bg-zinc-900 border-zinc-900 text-white'
                              : isDark
                              ? 'bg-[#0E0E11] border-[#27272A] text-zinc-300 hover:bg-zinc-800'
                              : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                          }`}
                        >
                          <svg
                            viewBox={preset.viewBox || '0 0 24 24'}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3.5 h-3.5"
                            dangerouslySetInnerHTML={{ __html: preset.svgInner }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* Single Color Circle + HEX Value Input + Palette + Canvas Eyedropper */}
                  <div className="flex items-center justify-between gap-2">
                    <ColorPickerField
                      id="icon"
                      label="Цвет"
                      value={activeLayer.iconColor || '#F43F5E'}
                      isDark={isDark}
                      isCanvasEyedropperActive={canvasEyedropperTarget === 'icon'}
                      onChange={(hex) =>
                        onUpdateLayerIcon(
                          activeLayer.id,
                          { iconColor: hex },
                          `Цвет иконки ${activeLayer.name}: ${hex}`
                        )
                      }
                      onToggleCanvasEyedropper={() => onToggleCanvasEyedropper('icon')}
                    />

                    <button
                      type="button"
                      onClick={() => setShowCustomSvgBox((v) => !v)}
                      title="Вставить собственный SVG-код иконки"
                      className="text-[10px] font-mono text-zinc-400 hover:text-zinc-100 flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Code2 className="w-3 h-3" />
                      <span>{showCustomSvgBox ? 'Скрыть SVG' : 'Свой SVG'}</span>
                    </button>
                  </div>

                  {showCustomSvgBox && (
                    <div className="space-y-1.5">
                      <textarea
                        rows={2}
                        value={customSvgInput}
                        onChange={(e) => setCustomSvgInput(e.target.value)}
                        placeholder="<svg>...</svg>"
                        className={`w-full p-2 rounded-md border font-mono text-[10px] ${inputClass}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!customSvgInput.trim()) return;
                          onUpdateLayerIcon(
                            activeLayer.id,
                            { customSvg: customSvgInput.trim() },
                            `Применён пользовательский SVG в ${activeLayer.name}`
                          );
                        }}
                        className={`w-full h-7 rounded-md text-[11px] font-medium cursor-pointer ${
                          isDark ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-white'
                        }`}
                      >
                        Применить SVG
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SECTION 5: MULTI-SCREEN BROADCAST (COLLAPSED BY DEFAULT) */}
          <div className="py-2">
            <button
              type="button"
              onClick={() => toggleSection('multiscreen')}
              title="Настройки синхронной трансляции правок на несколько экранов"
              className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5">
                {openSections.multiscreen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>Мультиэкран</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                {liveMultiScreenSync ? `${slotCount} экр.` : 'выкл'}
              </span>
            </button>

            {openSections.multiscreen && (
              <div className="flex items-center justify-between gap-1.5 pt-1.5">
                {slotCount < 2 && (
                  <button
                    type="button"
                    onClick={onEnableAdaptiveTwoScreens}
                    title="Открыть 2 экрана (393px и 320px) для параллельной проверки адаптивности"
                    className={`flex-1 h-7 px-2 rounded-md border text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                      isDark
                        ? 'bg-[#18181C] border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                        : 'bg-white border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    <MonitorSmartphone className="w-3.5 h-3.5" />
                    <span>+ 2 экрана</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleMultiScreenSync}
                  title="Включить или выключить синхронную трансляцию изменений на все открытые экраны"
                  className={`h-7 px-2.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                    liveMultiScreenSync
                      ? isDark
                        ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                        : 'bg-zinc-900 text-white border-zinc-900'
                      : isDark
                      ? 'bg-[#18181C] border-[#27272A] text-zinc-400'
                      : 'bg-white border-zinc-300 text-zinc-600'
                  }`}
                >
                  {liveMultiScreenSync ? 'Синхронизация ВКЛ' : 'Синхронизация ВЫКЛ'}
                </button>
              </div>
            )}
          </div>

          {/* SECTION 7: GENERATED TAILWIND DIFF (COLLAPSED BY DEFAULT) */}
          {builderDiff && (builderDiff.summaryLines.length > 0 || builderDiff.tailwindClasses) && (
            <div className="py-2">
              <button
                type="button"
                onClick={() => toggleSection('diff')}
                title="Показать сгенерированные классы Tailwind и список изменений слоя"
                className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
              >
                <div className="flex items-center gap-1.5">
                  {openSections.diff ? (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>Код для агента</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[120px]">
                  {builderDiff.tailwindClasses || `${builderDiff.summaryLines.length} изм.`}
                </span>
              </button>

              {openSections.diff && (
                <div
                  data-testid="builder-layer-diff"
                  className={`mt-1.5 p-2 rounded-md border text-[10px] font-mono space-y-1 ${borderMuted} ${
                    isDark ? 'bg-[#0E0E11] text-zinc-300' : 'bg-zinc-50 text-zinc-700'
                  }`}
                >
                  {builderDiff.summaryLines.map((line, i) => (
                    <div key={i} className="truncate">
                      • {line}
                    </div>
                  ))}
                  {builderDiff.tailwindClasses && (
                    <div className="font-semibold text-zinc-100 truncate">
                      {builderDiff.tailwindClasses}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SECTION: AGENT TASK DIRECTIVES & PROMPT */}
          <div className="py-2">
            <button
              type="button"
              onClick={() => toggleSection('agent')}
              title="Параметры задачи и комментарий для агента Antigravity"
              className="w-full flex items-center justify-between h-7 text-xs font-semibold cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5">
                {openSections.agent ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>Задача для агента</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Промпт</span>
            </button>

            {openSections.agent && (
              <div className="space-y-2 pt-1.5">
                {onChangeDirectiveId && (
                  <select
                    aria-label="Шаблон директивы для агента"
                    value={selectedDirectiveId}
                    onChange={(e) => onChangeDirectiveId(e.target.value)}
                    className={`w-full h-7 text-xs px-2 rounded-md border cursor-pointer ${inputClass}`}
                  >
                    {SMART_AGENT_DIRECTIVES.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}

                {onChangeNoteText && (
                  <textarea
                    rows={2}
                    value={noteText}
                    onChange={(e) => onChangeNoteText(e.target.value)}
                    placeholder="Комментарий для агента..."
                    className={`w-full rounded-md border p-2 text-xs focus:outline-none resize-none ${inputClass}`}
                  />
                )}

                {onCopySinglePrompt && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={onCopySinglePrompt}
                      title="Скопировать готовый промпт для этого элемента"
                      className={`w-full h-7 px-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                        isDark
                          ? 'bg-[#18181C] border-[#27272A] text-zinc-200 hover:bg-zinc-800'
                          : 'bg-zinc-100 border-zinc-300 text-zinc-800'
                      }`}
                    >
                      {copiedSingle ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedSingle ? 'Скопировано в буфер' : 'Скопировать промпт узла'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PRIMARY ACTION: SEND TO AGENT QUEUE */}
          <div className="pt-3">
            <button
              type="button"
              onClick={() => onEnqueueBuilderChanges(activeLayer)}
              title="Добавить изменения текущего слоя в очередь задач для агента Antigravity"
              className={`w-full h-8 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                isDark
                  ? 'bg-zinc-100 hover:bg-white text-zinc-950'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-white'
              }`}
            >
              {enqueuedSuccess ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{enqueuedSuccess ? 'Добавлено в очередь' : 'В очередь агента'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
