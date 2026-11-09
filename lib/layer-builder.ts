export type ResponsiveSizingUnit = '%' | 'auto' | 'rem' | 'vw' | 'px';

export type ResponsiveLayoutPreset =
  | 'none'
  | 'w-full'
  | 'w-auto'
  | 'flex-1'
  | 'w-1/2'
  | 'w-90-center';

export type LayerNodeKind = 'container' | 'text' | 'icon' | 'button' | 'input' | 'group';

export interface BuilderIconPreset {
  id: string;
  label: string;
  jsxName: string;
  svgInner: string;
  viewBox?: string;
}

export const BUILDER_ICON_PRESETS: BuilderIconPreset[] = [
  {
    id: 'heart',
    label: 'Сердце',
    jsxName: 'Heart',
    svgInner:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  },
  {
    id: 'star',
    label: 'Звезда',
    jsxName: 'Star',
    svgInner:
      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  },
  {
    id: 'flame',
    label: 'Огонь',
    jsxName: 'Flame',
    svgInner:
      '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  },
  {
    id: 'sparkles',
    label: 'Искры',
    jsxName: 'Sparkles',
    svgInner:
      '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/>',
  },
  {
    id: 'bolt',
    label: 'Молния',
    jsxName: 'Zap',
    svgInner: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
  {
    id: 'crown',
    label: 'Корона',
    jsxName: 'Crown',
    svgInner: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
  },
  {
    id: 'rocket',
    label: 'Ракета',
    jsxName: 'Rocket',
    svgInner:
      '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
  },
  {
    id: 'diamond',
    label: 'Бриллиант',
    jsxName: 'Gem',
    svgInner: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  },
  {
    id: 'bookmark',
    label: 'Закладка',
    jsxName: 'Bookmark',
    svgInner: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  },
  {
    id: 'bell',
    label: 'Колокол',
    jsxName: 'Bell',
    svgInner:
      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  },
  {
    id: 'check',
    label: 'Галочка',
    jsxName: 'CheckCircle2',
    svgInner: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  },
  {
    id: 'send',
    label: 'Telegram',
    jsxName: 'Send',
    svgInner: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  },
];

export type LayerBoxAlign = 'none' | 'left' | 'center' | 'right' | 'stretch';
export type LayerContentAlign = 'none' | 'left' | 'center' | 'right' | 'between';

export interface DesignLayerTransform {
  dx: number;
  dy: number;
  width: number;
  height: number;
  zIndex: number;
  orderIndex: number;
  widthUnit?: ResponsiveSizingUnit;
  widthPercent?: number;
  heightUnit?: 'auto' | 'px' | '%';
  heightPercent?: number;
  offsetUnit?: '%' | 'px';
  dxPercent?: number;
  responsivePreset?: ResponsiveLayoutPreset;
  useFlowSpacing?: boolean;
  boxAlign?: LayerBoxAlign;
  contentAlign?: LayerContentAlign;
}

export interface DesignLayerNode {
  id: string;
  name: string;
  tag: string;
  selector: string;
  depth: number;
  parentId: string | null;
  isGroup: boolean;
  childIds: string[];
  visible: boolean;
  locked: boolean;
  nodeKind?: LayerNodeKind;
  textValue?: string;
  initialTextValue?: string;
  textColor?: string;
  bgColor?: string;
  hasSvgIcon?: boolean;
  iconPresetId?: string;
  customSvgCode?: string;
  iconColor?: string;
  parentWidth?: number;
  parentHeight?: number;
  sourceFile?: string;
  sourceLine?: number;
  initialRect: { x: number; y: number; width: number; height: number };
  currentRect: { x: number; y: number; width: number; height: number };
  transform: DesignLayerTransform;
}

export type BuilderOperationType =
  | 'move'
  | 'resize'
  | 'reorder'
  | 'group'
  | 'ungroup'
  | 'duplicate'
  | 'visibility'
  | 'zindex'
  | 'text'
  | 'icon'
  | 'responsive'
  | 'style';

export interface BuilderOperationRecord {
  id: string;
  timestamp: string;
  type: BuilderOperationType;
  layerId: string;
  layerName: string;
  summary: string;
  tailwindHint: string;
  jsxStructuralHint?: string;
}

/**
 * Snaps a coordinate or dimension value to the nearest grid step (e.g. 4px or 8px) when snap is enabled.
 */
export function snapToGridValue(val: number, gridSize = 8, enabled = true): number {
  if (!enabled || gridSize <= 1) return Math.round(val);
  return Math.round(val / gridSize) * gridSize;
}

/**
 * Converts a pixel width to a responsive percentage relative to the parent container width,
 * clamped between 5% and 100%.
 */
export function computeResponsiveWidthPercent(pixelWidth: number, parentWidth: number): number {
  const safeParent = Math.max(80, parentWidth || 360);
  const pct = Math.round((pixelWidth / safeParent) * 100);
  return Math.max(5, Math.min(100, pct));
}

/**
 * Converts a pixel offset (dx) to a percentage of the parent container width (-100%..100%).
 */
export function computeResponsiveOffsetPercent(pixelOffset: number, parentWidth: number): number {
  const safeParent = Math.max(80, parentWidth || 360);
  const pct = Math.round((pixelOffset / safeParent) * 100);
  return Math.max(-100, Math.min(100, pct));
}

/**
 * Bi-directionally converts a layer's sizing transform between pixel ('px') and percentage/relative ('%', 'rem', 'vw', 'auto') modes.
 */
export function convertLayerSizingUnit(
  layer: DesignLayerNode,
  targetUnit: ResponsiveSizingUnit
): Partial<DesignLayerTransform> {
  const parentW = Math.max(80, layer.parentWidth || 360);
  const currentPxW = layer.transform.width || layer.currentRect.width || layer.initialRect.width;
  const pctW = computeResponsiveWidthPercent(currentPxW, parentW);
  const dxPct = computeResponsiveOffsetPercent(layer.transform.dx, parentW);

  if (targetUnit === '%') {
    return {
      widthUnit: '%',
      widthPercent: pctW,
      width: Math.round((parentW * pctW) / 100),
      heightUnit: 'auto',
      offsetUnit: '%',
      dxPercent: dxPct,
      responsivePreset: pctW >= 98 ? 'w-full' : 'none',
    };
  }

  if (targetUnit === 'px') {
    const resolvedPx =
      layer.transform.widthPercent !== undefined
        ? Math.round((parentW * layer.transform.widthPercent) / 100)
        : currentPxW;
    return {
      widthUnit: 'px',
      width: resolvedPx,
      heightUnit: 'px',
      offsetUnit: 'px',
      responsivePreset: 'none',
    };
  }

  return {
    widthUnit: targetUnit,
    widthPercent: pctW,
    responsivePreset: 'none',
  };
}

/**
 * Pure calculation for 8-handle bounding-box resizing.
 */
export function computeResizedBox(
  startBox: { dx: number; dy: number; width: number; height: number },
  handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  deltaMouseX: number,
  deltaMouseY: number,
  snapGrid = 0,
  minWidth = 24,
  minHeight = 20
): { dx: number; dy: number; width: number; height: number } {
  let { dx, dy, width, height } = startBox;

  if (handle.includes('e')) {
    width = Math.max(minWidth, startBox.width + deltaMouseX);
  }
  if (handle.includes('s')) {
    height = Math.max(minHeight, startBox.height + deltaMouseY);
  }
  if (handle.includes('w')) {
    const proposedW = startBox.width - deltaMouseX;
    if (proposedW >= minWidth) {
      width = proposedW;
      dx = startBox.dx + deltaMouseX;
    } else {
      width = minWidth;
      dx = startBox.dx + (startBox.width - minWidth);
    }
  }
  if (handle.includes('n')) {
    const proposedH = startBox.height - deltaMouseY;
    if (proposedH >= minHeight) {
      height = proposedH;
      dy = startBox.dy + deltaMouseY;
    } else {
      height = minHeight;
      dy = startBox.dy + (startBox.height - minHeight);
    }
  }

  if (snapGrid > 1) {
    width = snapToGridValue(width, snapGrid, true);
    height = snapToGridValue(height, snapGrid, true);
    dx = snapToGridValue(dx, snapGrid, true);
    dy = snapToGridValue(dy, snapGrid, true);
  } else {
    width = Math.round(width);
    height = Math.round(height);
    dx = Math.round(dx);
    dy = Math.round(dy);
  }

  return { dx, dy, width, height };
}

/**
 * Pure function to reorder a layer up or down in a list of layers.
 */
export function reorderLayerList(
  layers: DesignLayerNode[],
  targetId: string,
  direction: 'up' | 'down'
): DesignLayerNode[] {
  const idx = layers.findIndex((l) => l.id === targetId);
  if (idx === -1) return layers;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= layers.length) return layers;

  const copy = [...layers];
  const [moved] = copy.splice(idx, 1);
  copy.splice(targetIdx, 0, moved);
  return copy.map((item, i) => ({
    ...item,
    transform: { ...item.transform, orderIndex: i },
  }));
}

/**
 * Generates Tailwind utility classes and JSX structural instructions from a layer's builder transform,
 * including responsive sizing (% / rem / vw / w-full / flex-1), text edits, and icon replacements.
 */
export function formatLayerBuilderDiff(
  layer: DesignLayerNode,
  operations: BuilderOperationRecord[]
): {
  summaryLines: string[];
  tailwindClasses: string;
} {
  const classes: string[] = [];
  const summaryLines: string[] = [];

  const {
    dx,
    dy,
    width,
    height,
    zIndex,
    widthUnit = 'px',
    widthPercent,
    heightUnit = 'px',
    offsetUnit = 'px',
    dxPercent,
    responsivePreset = 'none',
    useFlowSpacing = false,
    boxAlign = 'none',
    contentAlign = 'none',
  } = layer.transform;
  const initW = Math.round(layer.initialRect.width);
  const initH = Math.round(layer.initialRect.height);

  // 1. Text Content & Text Color Edit Diff
  if (
    layer.textValue !== undefined &&
    layer.initialTextValue !== undefined &&
    layer.textValue !== layer.initialTextValue
  ) {
    summaryLines.push(
      `Изменение текста: "${layer.initialTextValue}" → "${layer.textValue}"`
    );
  }
  if (layer.textColor) {
    classes.push(`text-[${layer.textColor}]`);
    summaryLines.push(`Цвет текста: ${layer.textColor}`);
  }

  // 2. Icon / SVG Replacement Diff
  if (layer.iconPresetId) {
    const preset = BUILDER_ICON_PRESETS.find((p) => p.id === layer.iconPresetId);
    summaryLines.push(
      `Замена иконки на <${preset?.jsxName || layer.iconPresetId} /> (${preset?.label || layer.iconPresetId})`
    );
  } else if (layer.customSvgCode) {
    summaryLines.push('Замена иконки на пользовательский <svg>');
  }
  if (layer.iconColor && layer.iconColor !== layer.textColor) {
    classes.push(`text-[${layer.iconColor}]`);
    summaryLines.push(`Цвет иконки: ${layer.iconColor}`);
  } else if (layer.iconColor) {
    summaryLines.push(`Цвет иконки: ${layer.iconColor}`);
  }

  // 2B. Box & Content Alignment inside container
  if (boxAlign && boxAlign !== 'none') {
    if (boxAlign === 'left') {
      classes.push('mr-auto ml-0 self-start');
      summaryLines.push('Положение в контейнере: прижато к левому краю (mr-auto ml-0 self-start)');
    } else if (boxAlign === 'center') {
      classes.push('mx-auto self-center');
      summaryLines.push('Положение в контейнере: по центру (mx-auto self-center)');
    } else if (boxAlign === 'right') {
      classes.push('ml-auto mr-0 self-end');
      summaryLines.push('Положение в контейнере: прижато к правому краю (ml-auto mr-0 self-end)');
    } else if (boxAlign === 'stretch') {
      classes.push('w-full self-stretch');
      summaryLines.push('Положение в контейнере: растянуто на всю ширину (w-full self-stretch)');
    }
  }

  if (contentAlign && contentAlign !== 'none') {
    if (contentAlign === 'left') {
      classes.push('text-left justify-start');
      summaryLines.push('Выравнивание контента внутри блока: по левому краю (text-left justify-start)');
    } else if (contentAlign === 'center') {
      classes.push('text-center justify-center items-center');
      summaryLines.push('Выравнивание контента внутри блока: по центру (text-center justify-center)');
    } else if (contentAlign === 'right') {
      classes.push('text-right justify-end');
      summaryLines.push('Выравнивание контента внутри блока: по правому краю (text-right justify-end)');
    } else if (contentAlign === 'between') {
      classes.push('flex justify-between items-center');
      summaryLines.push('Распределение внутри блока: по краям (flex justify-between items-center)');
    }
  }

  // 3. Position / Spacing Diff (Supports both relative % and fixed px)
  if (dx !== 0 || dy !== 0) {
    const xVal =
      offsetUnit === '%' && dxPercent !== undefined ? `${dxPercent}%` : `${dx}px`;
    if (useFlowSpacing) {
      if (dx !== 0) classes.push(`ml-[${xVal}]`);
      if (dy !== 0) classes.push(`mt-[${dy}px]`);
      summaryLines.push(`Потоковый отступ (Margin): ml-[${xVal}] mt-[${dy}px]`);
    } else {
      if (dx !== 0) classes.push(`translate-x-[${xVal}]`);
      if (dy !== 0) classes.push(`translate-y-[${dy}px]`);
      summaryLines.push(
        `Смещение позиции (Drag): ΔX = ${xVal}, ΔY = ${dy > 0 ? `+${dy}` : dy}px`
      );
    }
  }

  // 4. Responsive vs Fixed Width Diff
  if (responsivePreset && responsivePreset !== 'none') {
    if (responsivePreset === 'w-full') {
      classes.push('w-full max-w-full');
      summaryLines.push('Адаптивная ширина: 100% контейнера (w-full max-w-full)');
    } else if (responsivePreset === 'w-auto') {
      classes.push('w-auto');
      summaryLines.push('Адаптивная ширина: по содержимому (w-auto)');
    } else if (responsivePreset === 'flex-1') {
      classes.push('flex-1 min-w-0');
      summaryLines.push('Адаптивная ширина: резиновый Flex-блок (flex-1 min-w-0)');
    } else if (responsivePreset === 'w-1/2') {
      classes.push('w-1/2 max-w-full');
      summaryLines.push('Адаптивная ширина: 50% контейнера (w-1/2)');
    } else if (responsivePreset === 'w-90-center') {
      classes.push('w-[90%] mx-auto max-w-full');
      summaryLines.push('Адаптивная карточка: 90% с центровкой (w-[90%] mx-auto)');
    }
  } else if (widthUnit === '%' && widthPercent !== undefined) {
    if (widthPercent >= 98 && Math.abs(width - initW) > 1) {
      classes.push('w-full max-w-full');
      summaryLines.push('Адаптивная ширина: 100% от родителя (w-full max-w-full)');
    } else if (widthPercent < 98 || Math.abs(width - initW) > 1) {
      classes.push(`w-[${widthPercent}%] max-w-full`);
      summaryLines.push(
        `Адаптивная ширина (%): ${widthPercent}% от родителя (w-[${widthPercent}%] max-w-full)`
      );
    }
  } else if (widthUnit === 'rem' && width > 0 && Math.abs(width - initW) > 1) {
    const remVal = Number((width / 16).toFixed(2));
    classes.push(`w-[${remVal}rem] max-w-full`);
    summaryLines.push(`Масштабируемая ширина (rem): ${remVal}rem (${width}px)`);
  } else if (widthUnit === 'vw' && width > 0) {
    const vwVal = Math.max(10, Math.min(100, Math.round((width / 393) * 100)));
    classes.push(`w-[${vwVal}vw] max-w-full`);
    summaryLines.push(`Ширина от экрана (vw): ${vwVal}vw`);
  } else if (width > 0 && Math.abs(width - initW) > 1) {
    classes.push(`w-[${width}px]`);
    summaryLines.push(`Изменение ширины (Resize): ${initW}px → ${width}px`);
  }

  // 5. Height Diff (Supports adaptive auto/min-h vs fixed px)
  if (height > 0 && Math.abs(height - initH) > 1) {
    if (heightUnit === 'auto' || widthUnit === '%') {
      classes.push(`min-h-[${height}px] h-auto`);
      summaryLines.push(`Адаптивная высота: min-h-[${height}px] h-auto (не обрезает текст на узких экранах)`);
    } else if (widthUnit === 'rem') {
      const remH = Number((height / 16).toFixed(2));
      classes.push(`min-h-[${remH}rem]`);
      summaryLines.push(`Минимальная высота (rem): ${remH}rem (${height}px)`);
    } else {
      classes.push(`h-[${height}px]`);
      summaryLines.push(`Изменение высоты (Resize): ${initH}px → ${height}px`);
    }
  }

  // 6. Z-Index Diff
  if (zIndex !== 0) {
    classes.push(`z-[${zIndex}] relative`);
    summaryLines.push(`Слой Z-Index: z-[${zIndex}]`);
  }

  const layerOps = operations.filter((op) => op.layerId === layer.id);
  layerOps.forEach((op) => {
    if (op.jsxStructuralHint && !summaryLines.includes(op.jsxStructuralHint)) {
      summaryLines.push(op.jsxStructuralHint);
    }
  });

  return {
    summaryLines,
    tailwindClasses: classes.join(' '),
  };
}

function oklabToHex(L: number, a: number, b: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toSrgbByte = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const gamma =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(gamma * 255)));
  };

  return (
    '#' +
    [toSrgbByte(rLin), toSrgbByte(gLin), toSrgbByte(bLin)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Converts an rgb(...) / rgba(...) / oklch(...) / oklab(...) / color(srgb ...) or hex string
 * into a standardized uppercase #RRGGBB string.
 */
export function rgbStringToHex(colorStr: string, fallback = '#FFFFFF'): string {
  if (!colorStr) return fallback;
  const trimmed = colorStr.trim();
  if (trimmed.startsWith('#')) {
    const clean = trimmed.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
      return (
        '#' +
        clean
          .split('')
          .map((c) => c + c)
          .join('')
          .toUpperCase()
      );
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return '#' + clean.toUpperCase();
    }
    if (/^[0-9a-fA-F]{8}$/.test(clean)) {
      return '#' + clean.slice(0, 6).toUpperCase();
    }
  }

  // Standard comma or space-separated rgb/rgba
  const rgbMatch = trimmed.match(
    /rgba?\(\s*([\d.]+)\s*[\s,]\s*([\d.]+)\s*[\s,]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i
  );
  if (rgbMatch) {
    const rawAlpha = rgbMatch[4];
    const alpha =
      rawAlpha !== undefined
        ? rawAlpha.endsWith('%')
          ? parseFloat(rawAlpha) / 100
          : parseFloat(rawAlpha)
        : 1;
    if (alpha === 0) return fallback;
    const r = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[1]))));
    const g = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[2]))));
    const b = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[3]))));
    return (
      '#' +
      [r, g, b]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  // Tailwind v4 oklch(L C H / alpha)
  const oklchMatch = trimmed.match(
    /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)/i
  );
  if (oklchMatch) {
    const rawAlpha = oklchMatch[4];
    const alpha =
      rawAlpha !== undefined
        ? rawAlpha.endsWith('%')
          ? parseFloat(rawAlpha) / 100
          : parseFloat(rawAlpha)
        : 1;
    if (alpha === 0) return fallback;
    const rawL = oklchMatch[1];
    const L = rawL.endsWith('%') ? parseFloat(rawL) / 100 : parseFloat(rawL);
    const C = parseFloat(oklchMatch[2]);
    const H = (parseFloat(oklchMatch[3]) * Math.PI) / 180;
    return oklabToHex(L, C * Math.cos(H), C * Math.sin(H));
  }

  // Tailwind v4 oklab(L a b / alpha)
  const oklabMatch = trimmed.match(
    /oklab\(\s*([\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i
  );
  if (oklabMatch) {
    const rawAlpha = oklabMatch[4];
    const alpha =
      rawAlpha !== undefined
        ? rawAlpha.endsWith('%')
          ? parseFloat(rawAlpha) / 100
          : parseFloat(rawAlpha)
        : 1;
    if (alpha === 0) return fallback;
    const rawL = oklabMatch[1];
    const L = rawL.endsWith('%') ? parseFloat(rawL) / 100 : parseFloat(rawL);
    const a = parseFloat(oklabMatch[2]);
    const b = parseFloat(oklabMatch[3]);
    return oklabToHex(L, a, b);
  }

  // CSS Color 4 color(srgb r g b / alpha)
  const srgbMatch = trimmed.match(
    /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i
  );
  if (srgbMatch) {
    const rawAlpha = srgbMatch[4];
    const alpha =
      rawAlpha !== undefined
        ? rawAlpha.endsWith('%')
          ? parseFloat(rawAlpha) / 100
          : parseFloat(rawAlpha)
        : 1;
    if (alpha === 0) return fallback;
    const r = Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[1]) * 255)));
    const g = Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[2]) * 255)));
    const b = Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[3]) * 255)));
    return (
      '#' +
      [r, g, b]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  return fallback;
}

/**
 * Normalizes user-typed color input (e.g. "a855f7", "#fff", "#38bdf8", "rgb(16, 185, 129)") into #RRGGBB.
 */
export function normalizeHexColor(raw: string, fallback = '#FFFFFF'): string {
  if (!raw) return fallback;
  const clean = raw.trim();
  if (clean.toLowerCase().startsWith('rgb')) {
    return rgbStringToHex(clean, fallback);
  }
  const withoutHash = clean.replace(/^#+/, '');
  if (/^[0-9a-fA-F]{3}$/.test(withoutHash)) {
    return (
      '#' +
      withoutHash
        .split('')
        .map((c) => c + c)
        .join('')
        .toUpperCase()
    );
  }
  if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
    return '#' + withoutHash.toUpperCase();
  }
  return fallback;
}

/**
 * Checks whether an element bounding box intersects a user-selected screenshot crop region.
 */
export function doesRectIntersectCrop(
  elRect: { x: number; y: number; width: number; height: number },
  cropRect: { x: number; y: number; width: number; height: number }
): boolean {
  if (elRect.width <= 1 || elRect.height <= 1) return false;
  const elRight = elRect.x + elRect.width;
  const elBottom = elRect.y + elRect.height;
  const cropRight = cropRect.x + cropRect.width;
  const cropBottom = cropRect.y + cropRect.height;

  const overlapX = Math.max(0, Math.min(elRight, cropRight) - Math.max(elRect.x, cropRect.x));
  const overlapY = Math.max(0, Math.min(elBottom, cropBottom) - Math.max(elRect.y, cropRect.y));
  return overlapX >= 4 && overlapY >= 4;
}

/**
 * Converts a #RRGGBB hex string to HSV ({ h: 0..360, s: 0..100, v: 0..100 }).
 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const clean = normalizeHexColor(hex, '#FF0000').slice(1);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

/**
 * Converts HSV ({ h: 0..360, s: 0..100, v: 0..100 }) to an uppercase #RRGGBB hex string.
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const hNorm = ((h % 360) + 360) % 360;
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const vNorm = Math.max(0, Math.min(100, v)) / 100;

  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = vNorm - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hNorm < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hNorm < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hNorm < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hNorm < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hNorm < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const r = Math.round((rPrime + m) * 255);
  const g = Math.round((gPrime + m) * 255);
  const b = Math.round((bPrime + m) * 255);

  return (
    '#' +
    [r, g, b]
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}


