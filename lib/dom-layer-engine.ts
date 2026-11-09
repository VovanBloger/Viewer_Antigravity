import {
  DesignLayerNode,
  DesignLayerTransform,
  LayerNodeKind,
  ResponsiveSizingUnit,
  ResponsiveLayoutPreset,
  LayerBoxAlign,
  LayerContentAlign,
  BUILDER_ICON_PRESETS,
  computeResizedBox,
  computeResponsiveWidthPercent,
  computeResponsiveOffsetPercent,
  rgbStringToHex,
} from './layer-builder';
import { getReactSourceInfo, buildDomSelectorPath } from './dom-inspector';

let groupCounter = 1;
let cloneCounter = 1;

function hasDirectTextNode(el: HTMLElement): string {
  let text = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  });
  return text.trim();
}

function classifyLayerNodeKind(el: HTMLElement): LayerNodeKind {
  if (el.getAttribute('data-ag-group') === 'true') return 'group';
  const tag = el.tagName.toLowerCase();
  if (tag === 'svg' || tag === 'path') return 'icon';
  if (tag === 'input' || tag === 'textarea') return 'input';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
  if (
    ['h1', 'h2', 'h3', 'h4', 'p', 'span', 'label'].includes(tag) ||
    (hasDirectTextNode(el).length > 0 && el.children.length === 0)
  ) {
    return 'text';
  }
  return 'container';
}

function getReadableLayerName(el: HTMLElement, fallbackIdx: number): string {
  const comp = el.getAttribute('data-component');
  if (comp) return comp;

  const aria = el.getAttribute('aria-label');
  if (aria) {
    return aria.length > 24 ? `${aria.slice(0, 24)}…` : aria;
  }

  const directText = hasDirectTextNode(el);
  if (directText) {
    return directText.length > 22 ? `${directText.slice(0, 22)}…` : directText;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'svg') return `Иконка SVG`;
  if (tag === 'header') return `Шапка`;
  if (tag === 'nav') return `Навигация`;
  if (tag === 'main') return `Основной контент`;
  if (tag === 'footer') return `Подвал`;
  if (tag === 'section') return `Секция`;
  if (tag === 'article') return `Статья`;
  if (tag === 'button') return `Кнопка`;
  if (tag === 'input') return `Поле ввода`;

  // For headings and text tags, pick their text if available
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span'].includes(tag)) {
    const txt = el.textContent?.trim();
    if (txt) {
      return txt.length > 22 ? `${txt.slice(0, 22)}…` : txt;
    }
    return tag.toUpperCase();
  }

  // Check inner heading/text to give containers clear titles
  const innerHeading = el.querySelector('h1, h2, h3, h4, [data-component]') as HTMLElement | null;
  if (innerHeading) {
    const compName = innerHeading.getAttribute('data-component');
    if (compName) return `Блок: ${compName}`;
    const hTxt = innerHeading.textContent?.trim();
    if (hTxt) {
      return `Блок: ${hTxt.length > 18 ? `${hTxt.slice(0, 18)}…` : hTxt}`;
    }
  }

  // Detect visual role from CSS classes
  const cls = (typeof el.className === 'string' ? el.className : '') || '';
  if (cls.includes('grid')) return `Сетка (${el.children.length} эл.)`;
  if (cls.includes('gradient')) return `Баннер / Градиент`;
  if (cls.includes('rounded') && (cls.includes('bg-') || cls.includes('border'))) return `Карточка`;
  if (cls.includes('flex-col')) return `Колонка`;
  if (cls.includes('flex')) return `Строка (Flex)`;
  if (cls.includes('badge') || (cls.includes('px-') && cls.includes('py-'))) return `Бейдж`;

  if (el.children.length > 0) {
    return `Контейнер (${el.children.length} эл.)`;
  }

  return `Блок <${tag}>`;
}

export function ensureLayerAttributes(el: Element, fallbackIndex: number): string {
  let id = el.getAttribute('data-ag-layer-id');
  if (!id) {
    const comp = el.getAttribute('data-component');
    id = comp ? `layer-${comp}` : `layer-node-${fallbackIndex}`;
    el.setAttribute('data-ag-layer-id', id);
  }
  const r = el.getBoundingClientRect();
  if (!el.hasAttribute('data-ag-init-w')) {
    el.setAttribute('data-ag-init-x', String(Math.round(r.left)));
    el.setAttribute('data-ag-init-y', String(Math.round(r.top)));
    el.setAttribute('data-ag-init-w', String(Math.round(r.width)));
    el.setAttribute('data-ag-init-h', String(Math.round(r.height)));
  }
  if (el.tagName.toLowerCase() !== 'svg' && el.tagName.toLowerCase() !== 'path') {
    const directTxt = hasDirectTextNode(el as HTMLElement);
    if (directTxt && !el.hasAttribute('data-ag-init-text')) {
      el.setAttribute('data-ag-init-text', directTxt);
    }
  }
  return id;
}

/**
 * Decomposes the iframe DOM into a deep hierarchical list of DesignLayerNode items
 * including containers, cards, nested texts ("Кибер-Кот #01", "@VovanBloger"), buttons, and SVG icons.
 */
export function extractIframeDesignLayers(doc: Document): DesignLayerNode[] {
  const demoRoot = doc.querySelector('[data-component="DemoApp"]') as HTMLElement | null;
  const rootApp = demoRoot || doc.body;
  if (!rootApp) return [];

  const rawElements = Array.from(
    rootApp.querySelectorAll(
      '[data-ag-layer-id], [data-component], [data-ag-group="true"], section, article, nav, header, main, footer, div[class*="rounded"], div[class*="bg-"], h1, h2, h3, h4, p, span, button, input, textarea, svg, [role="button"]'
    )
  ) as HTMLElement[];

  const candidates = rawElements.filter((el) => {
    if (!el || el.id?.startsWith('__antigravity')) return false;
    if (el.closest('#__antigravity_builder_gizmo__')) return false;
    if (el.closest('[data-nextjs-dev-tools-button]')) return false;
    if (el.getAttribute('aria-label') === 'Open Next.js Dev Tools') return false;
    if (el.getAttribute('data-component') === 'DemoApp') return false;
    return true;
  });

  candidates.forEach((el, idx) => {
    ensureLayerAttributes(el, idx);
  });

  const result: DesignLayerNode[] = [];

  candidates.forEach((el, idx) => {
    const id = el.getAttribute('data-ag-layer-id') || `layer-node-${idx}`;
    const name = getReadableLayerName(el, idx);
    const isGroup = el.getAttribute('data-ag-group') === 'true';
    const nodeKind = classifyLayerNodeKind(el);

    let parentEl: Element | null = el.parentElement;
    let parentId: string | null = null;
    let depth = 0;

    while (parentEl && parentEl !== rootApp && parentEl !== doc.body) {
      const pid = parentEl.getAttribute('data-ag-layer-id');
      if (pid) {
        if (!parentId) parentId = pid;
        depth++;
      }
      parentEl = parentEl.parentElement;
    }

    const r = el.getBoundingClientRect();
    const parentRect = el.parentElement?.getBoundingClientRect();
    const parentWidth = Math.round(parentRect?.width || 360);
    const parentHeight = Math.round(parentRect?.height || 640);

    const initX = parseInt(el.getAttribute('data-ag-init-x') || String(Math.round(r.left)), 10);
    const initY = parseInt(el.getAttribute('data-ag-init-y') || String(Math.round(r.top)), 10);
    const initW = parseInt(el.getAttribute('data-ag-init-w') || String(Math.round(r.width)), 10);
    const initH = parseInt(el.getAttribute('data-ag-init-h') || String(Math.round(r.height)), 10);

    const dx = parseInt(el.getAttribute('data-ag-dx') || '0', 10) || 0;
    const dy = parseInt(el.getAttribute('data-ag-dy') || '0', 10) || 0;
    const customW = parseInt(
      el.getAttribute('data-ag-w') || String(Math.round(r.width || initW)),
      10
    );
    const customH = parseInt(
      el.getAttribute('data-ag-h') || String(Math.round(r.height || initH)),
      10
    );
    const zIndex = parseInt(el.getAttribute('data-ag-z') || '0', 10) || 0;

    const widthUnit = (el.getAttribute('data-ag-w-unit') || '%') as ResponsiveSizingUnit;
    const widthPercentAttr = el.getAttribute('data-ag-w-pct');
    const widthPercent = widthPercentAttr
      ? parseInt(widthPercentAttr, 10)
      : computeResponsiveWidthPercent(Math.round(r.width || customW), parentWidth);

    const heightUnit = (el.getAttribute('data-ag-h-unit') ||
      (widthUnit === '%' ? 'auto' : 'px')) as 'auto' | 'px' | '%';
    const offsetUnit = (el.getAttribute('data-ag-offset-unit') ||
      (widthUnit === '%' ? '%' : 'px')) as '%' | 'px';
    const dxPercentAttr = el.getAttribute('data-ag-dx-pct');
    const dxPercent = dxPercentAttr
      ? parseInt(dxPercentAttr, 10)
      : computeResponsiveOffsetPercent(dx, parentWidth);

    const responsivePreset = (el.getAttribute('data-ag-resp-preset') ||
      'none') as ResponsiveLayoutPreset;
    const useFlowSpacing = el.getAttribute('data-ag-flow-space') === 'true';
    const boxAlign = (el.getAttribute('data-ag-box-align') || 'none') as LayerBoxAlign;
    const contentAlign = (el.getAttribute('data-ag-content-align') || 'none') as LayerContentAlign;

    const visible = el.getAttribute('data-ag-hidden') !== 'true';
    const locked = el.getAttribute('data-ag-locked') === 'true';
    const { sourceFile, sourceLine } = getReactSourceInfo(el);

    const tag = el.tagName.toLowerCase();
    const directText = tag !== 'svg' && tag !== 'path' ? hasDirectTextNode(el) : '';
    const initialTextValue = el.getAttribute('data-ag-init-text') || directText || undefined;
    const textValue = directText || undefined;
    const textColor = el.getAttribute('data-ag-text-color') || undefined;
    const bgColor = el.getAttribute('data-ag-bg-color') || undefined;

    const hasSvgIcon = tag === 'svg' || Boolean(el.querySelector('svg'));
    const iconPresetId = el.getAttribute('data-ag-icon-preset') || undefined;
    const customSvgCode = el.getAttribute('data-ag-custom-svg') || undefined;
    const iconColor = el.getAttribute('data-ag-icon-color') || undefined;

    const childEls = candidates.filter((cand) => {
      if (cand === el) return false;
      const closestParentLayer = cand.parentElement?.closest('[data-ag-layer-id]');
      return closestParentLayer === el;
    });
    const childIds = childEls
      .map((c) => c.getAttribute('data-ag-layer-id') || '')
      .filter(Boolean);

    result.push({
      id,
      name,
      tag,
      selector: buildDomSelectorPath(el),
      depth: Math.min(depth, 5),
      parentId,
      isGroup,
      childIds,
      visible,
      locked,
      nodeKind,
      textValue,
      initialTextValue,
      textColor,
      bgColor,
      hasSvgIcon,
      iconPresetId,
      customSvgCode,
      iconColor,
      parentWidth,
      parentHeight,
      sourceFile,
      sourceLine,
      initialRect: { x: initX, y: initY, width: initW, height: initH },
      currentRect: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width || customW),
        height: Math.round(r.height || customH),
      },
      transform: {
        dx,
        dy,
        width: Math.round(r.width || customW),
        height: Math.round(r.height || customH),
        zIndex,
        orderIndex: idx,
        widthUnit,
        widthPercent,
        heightUnit,
        offsetUnit,
        dxPercent,
        responsivePreset,
        useFlowSpacing,
        boxAlign,
        contentAlign,
      },
    });
  });

  return result;
}

export function findDomElementByLayerId(doc: Document, layerId: string): HTMLElement | null {
  const existing = doc.querySelector(`[data-ag-layer-id="${layerId}"]`) as HTMLElement | null;
  if (existing) return existing;
  extractIframeDesignLayers(doc);
  return doc.querySelector(`[data-ag-layer-id="${layerId}"]`) as HTMLElement | null;
}

/**
 * Updates the text content of a layer in the live DOM without destroying child SVG icons.
 */
export function updateDomLayerText(doc: Document, layerId: string, newText: string): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return false;

  if (!el.hasAttribute('data-ag-init-text')) {
    el.setAttribute('data-ag-init-text', hasDirectTextNode(el));
  }

  let updatedTextNode = false;
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && !updatedTextNode) {
      if ((node.textContent || '').trim().length > 0 || el.childNodes.length === 1) {
        node.textContent = newText;
        updatedTextNode = true;
      }
    }
  });

  if (!updatedTextNode) {
    const textChild = el.querySelector('span, h1, h2, h3, p') as HTMLElement | null;
    if (textChild && textChild.children.length === 0) {
      textChild.textContent = newText;
      updatedTextNode = true;
    } else if (el.children.length === 0) {
      el.textContent = newText;
      updatedTextNode = true;
    } else {
      const span = doc.createElement('span');
      span.textContent = newText;
      el.appendChild(span);
      updatedTextNode = true;
    }
  }

  return updatedTextNode;
}

/**
 * Updates the text color of a layer in the live DOM and persists it in data-ag-text-color.
 */
export function updateDomLayerTextColor(doc: Document, layerId: string, colorHex: string): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return false;

  el.style.color = colorHex;
  el.setAttribute('data-ag-text-color', colorHex);

  const textChildren = Array.from(el.querySelectorAll('span, h1, h2, h3, p')) as HTMLElement[];
  textChildren.forEach((child) => {
    if (child.children.length === 0) {
      child.style.color = colorHex;
    }
  });

  return true;
}

/**
 * Updates the background color of a layer in the live DOM and persists it in data-ag-bg-color.
 */
export function updateDomLayerBgColor(doc: Document, layerId: string, colorHex: string): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return false;

  el.style.backgroundColor = colorHex;
  el.setAttribute('data-ag-bg-color', colorHex);
  return true;
}

function rgbBytesToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Renders the visible iframe screen surfaces (backgrounds, translucent rgba cards,
 * linear gradients, and borders) onto a 1:1 viewport canvas so the Eyedropper
 * can read the exact displayed RGB pixel at any (clientX, clientY) coordinate.
 */
export function renderScreenSurfaceCanvas(doc: Document): HTMLCanvasElement | null {
  try {
    const win = doc.defaultView || window;
    const width = Math.max(320, win.innerWidth || 393);
    const height = Math.max(480, win.innerHeight || 852);
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Base dark backdrop of the mobile screen
    ctx.fillStyle = '#0F0E17';
    ctx.fillRect(0, 0, width, height);

    const allNodes = [
      doc.documentElement,
      doc.body,
      ...Array.from(doc.body ? doc.body.querySelectorAll('*') : []),
    ].filter(Boolean) as HTMLElement[];

    allNodes.forEach((el) => {
      try {
        if (!el || el.id?.startsWith('__antigravity')) return;
        if (el.closest('#__antigravity_builder_gizmo__')) return;
        if (el.closest('#__antigravity_eyedropper_loupe__')) return;
        if (el.closest('[data-nextjs-dev-tools-button]')) return;
        if (el.getAttribute('aria-label') === 'Open Next.js Dev Tools') return;

        const tag = el.tagName.toLowerCase();
        if (['path', 'polygon', 'circle', 'defs', 'style', 'script', 'svg'].includes(tag)) {
          return;
        }

        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (r.right < 0 || r.bottom < 0 || r.left > width || r.top > height) return;

        const comp = win.getComputedStyle(el);
        if (
          comp.display === 'none' ||
          comp.visibility === 'hidden' ||
          parseFloat(comp.opacity || '1') === 0
        ) {
          return;
        }

        const rad = Math.min(
          Math.min(r.width, r.height) / 2,
          Math.max(0, parseFloat(comp.borderTopLeftRadius || '0') || 0)
        );

        const hasBgImg = comp.backgroundImage && comp.backgroundImage !== 'none';
        const hasBgColor =
          comp.backgroundColor &&
          comp.backgroundColor !== 'transparent' &&
          comp.backgroundColor !== 'rgba(0, 0, 0, 0)';

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, parseFloat(comp.opacity || '1') || 1));
        if (comp.filter && comp.filter !== 'none') {
          ctx.filter = comp.filter;
        }

        if (hasBgColor) {
          ctx.beginPath();
          ctx.roundRect(r.left, r.top, r.width, r.height, rad);
          ctx.fillStyle = comp.backgroundColor;
          ctx.fill();
        }

        if (hasBgImg && comp.backgroundImage.includes('gradient')) {
          const stopMatches = comp.backgroundImage.match(
            /(?:oklab|oklch|rgba?|hsla?|color)\([^)]+\)|#[0-9a-fA-F]{3,8}|transparent/gi
          );
          if (stopMatches && stopMatches.length >= 2) {
            let x1 = r.left + r.width;
            let y1 = r.top + r.height;
            if (
              comp.backgroundImage.includes('to right') &&
              !comp.backgroundImage.includes('bottom')
            ) {
              x1 = r.left + r.width;
              y1 = r.top;
            } else if (
              comp.backgroundImage.includes('to bottom') &&
              !comp.backgroundImage.includes('right')
            ) {
              x1 = r.left;
              y1 = r.top + r.height;
            }
            const grad = ctx.createLinearGradient(r.left, r.top, x1, y1);
            stopMatches.forEach((stopColor, sIdx) => {
              const offset = sIdx / (stopMatches.length - 1);
              try {
                grad.addColorStop(offset, stopColor);
              } catch {
                grad.addColorStop(offset, rgbStringToHex(stopColor, '#3B1D7A'));
              }
            });
            ctx.beginPath();
            ctx.roundRect(r.left, r.top, r.width, r.height, rad);
            ctx.fillStyle = grad;
            ctx.fill();
          }
        }

        const borderW = parseFloat(comp.borderTopWidth || '0') || 0;
        if (
          borderW > 0 &&
          comp.borderTopStyle !== 'none' &&
          comp.borderTopColor &&
          comp.borderTopColor !== 'transparent' &&
          comp.borderTopColor !== 'rgba(0, 0, 0, 0)'
        ) {
          ctx.beginPath();
          ctx.roundRect(
            r.left + 0.5,
            r.top + 0.5,
            Math.max(1, r.width - 1),
            Math.max(1, r.height - 1),
            Math.max(0, rad - 0.5)
          );
          ctx.lineWidth = Math.max(1.5, borderW);
          ctx.strokeStyle = comp.borderTopColor;
          ctx.stroke();
        }

        ctx.restore();
      } catch {
        // Ignore single element canvas draw error
      }
    });

    return canvas;
  } catch {
    return null;
  }
}

/**
 * Samples the exact displayed screen color at viewport coordinates (clientX, clientY):
 * 1. If the cursor is over an <svg> icon shape, samples the icon stroke/fill color.
 * 2. If the cursor is directly over a rendered non-whitespace character glyph, samples the text color.
 * 3. Otherwise reads the exact composited RGB pixel from the rendered screen surface canvas
 *    (including dark page background #0F0E17, card rgba surfaces, borders, and gradient pixels).
 */
export function sampleScreenColorAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
  surfaceCanvas?: HTMLCanvasElement | null
): string {
  try {
    const win = doc.defaultView || window;
    const hitElements = doc
      .elementsFromPoint(clientX, clientY)
      .filter(
        (el) =>
          el &&
          !el.id?.startsWith('__antigravity') &&
          !el.closest('#__antigravity_builder_gizmo__') &&
          !el.closest('#__antigravity_eyedropper_loupe__')
      );

    // 1. Check if cursor is directly over an SVG icon element
    for (let i = 0; i < Math.min(3, hitElements.length); i++) {
      const el = hitElements[i];
      const tag = el.tagName.toLowerCase();
      if (['svg', 'path', 'polygon', 'circle', 'rect', 'line', 'polyline'].includes(tag)) {
        const svgRoot = tag === 'svg' ? el : el.closest('svg');
        const explicitIconColor = svgRoot
          ?.closest('[data-ag-icon-color]')
          ?.getAttribute('data-ag-icon-color');
        if (explicitIconColor) {
          return rgbStringToHex(explicitIconColor, '#A855F7');
        }
        const comp = win.getComputedStyle(el);
        if (
          comp.fill &&
          comp.fill !== 'none' &&
          comp.fill !== 'transparent' &&
          comp.fill !== 'rgba(0, 0, 0, 0)' &&
          comp.fill !== 'rgb(0, 0, 0)'
        ) {
          return rgbStringToHex(comp.fill, '#A855F7');
        }
        if (
          comp.stroke &&
          comp.stroke !== 'none' &&
          comp.stroke !== 'transparent' &&
          comp.stroke !== 'rgba(0, 0, 0, 0)'
        ) {
          return rgbStringToHex(comp.stroke, '#A855F7');
        }
        if (svgRoot) {
          const svgComp = win.getComputedStyle(svgRoot);
          if (svgComp.color) {
            return rgbStringToHex(svgComp.color, '#FFFFFF');
          }
        }
      }
    }

    // 2. Check if cursor is physically over a rendered non-whitespace character glyph
    for (let i = 0; i < Math.min(2, hitElements.length); i++) {
      const el = hitElements[i] as HTMLElement;
      if (!el || !el.childNodes || el.childNodes.length === 0) continue;

      for (let c = 0; c < el.childNodes.length; c++) {
        const node = el.childNodes[c];
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.textContent || '';
        if (!text.trim()) continue;

        const range = doc.createRange();
        range.selectNodeContents(node);
        const lineRects = Array.from(range.getClientRects());
        const insideLine = lineRects.some(
          (lr) =>
            clientX >= lr.left - 1 &&
            clientX <= lr.right + 1 &&
            clientY >= lr.top - 1 &&
            clientY <= lr.bottom + 1
        );
        if (!insideLine) continue;

        for (let charIdx = 0; charIdx < text.length; charIdx++) {
          if (text[charIdx].trim().length === 0) continue;
          range.setStart(node, charIdx);
          range.setEnd(node, charIdx + 1);
          const cr = range.getBoundingClientRect();
          if (
            clientX >= cr.left - 1.5 &&
            clientX <= cr.right + 1.5 &&
            clientY >= cr.top - 1.5 &&
            clientY <= cr.bottom + 1.5
          ) {
            const explicitText = el.getAttribute?.('data-ag-text-color');
            if (explicitText) return rgbStringToHex(explicitText, '#FFFFFF');
            const comp = win.getComputedStyle(el);
            if (comp.color) return rgbStringToHex(comp.color, '#FFFFFF');
          }
        }
      }
    }

    // 3. Read exact composited pixel from the 1:1 rendered screen surface canvas
    const activeCanvas = surfaceCanvas || renderScreenSurfaceCanvas(doc);
    if (activeCanvas) {
      const ctx = activeCanvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const px = Math.max(0, Math.min(activeCanvas.width - 1, Math.round(clientX)));
        const py = Math.max(0, Math.min(activeCanvas.height - 1, Math.round(clientY)));
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel && pixel[3] > 0) {
          return rgbBytesToHex(pixel[0], pixel[1], pixel[2]);
        }
      }
    }

    // 4. Fallback: walk down the hit elements stack to find the first visible background or gradient
    for (const el of hitElements) {
      const comp = win.getComputedStyle(el);
      if (
        comp.backgroundColor &&
        comp.backgroundColor !== 'transparent' &&
        comp.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ) {
        return rgbStringToHex(comp.backgroundColor, '#0F0E17');
      }
      if (comp.backgroundImage && comp.backgroundImage !== 'none') {
        const stopMatch = comp.backgroundImage.match(
          /(?:oklab|oklch|rgba?|hsla?|color)\([^)]+\)|#[0-9a-fA-F]{3,8}/i
        );
        if (stopMatch) {
          return rgbStringToHex(stopMatch[0], '#3B1D7A');
        }
      }
    }
  } catch {
    // Ignore
  }
  return '#0F0E17';
}

/**
 * Samples the primary visual color (SVG stroke/fill, text color for leaf text nodes, or background)
 * from a DOM element for layer metadata extraction.
 */
export function sampleElementColorFromDom(el: Element, win: Window): string {
  try {
    const htmlEl = el as HTMLElement;
    const explicitIcon = htmlEl.getAttribute?.('data-ag-icon-color');
    if (explicitIcon) return rgbStringToHex(explicitIcon, '#A855F7');
    const explicitText = htmlEl.getAttribute?.('data-ag-text-color');
    if (explicitText) return rgbStringToHex(explicitText, '#FFFFFF');

    const comp = win.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    if (tag === 'svg' || tag === 'path' || tag === 'polygon' || tag === 'circle') {
      const stroke = comp.stroke;
      if (stroke && stroke !== 'none' && stroke !== 'transparent') {
        return rgbStringToHex(stroke, '#A855F7');
      }
      const fill = comp.fill;
      if (fill && fill !== 'none' && fill !== 'transparent' && fill !== 'rgb(0, 0, 0)') {
        return rgbStringToHex(fill, '#A855F7');
      }
      if (comp.color) return rgbStringToHex(comp.color, '#FFFFFF');
    }

    if (
      ['h1', 'h2', 'h3', 'h4', 'p', 'span', 'label'].includes(tag) ||
      (hasDirectTextNode(htmlEl).length > 0 && el.children.length === 0)
    ) {
      if (comp.color) {
        return rgbStringToHex(comp.color, '#FFFFFF');
      }
    }

    // Walk up the DOM tree to find the nearest visible background or gradient
    let curr: Element | null = el;
    while (curr) {
      const c = win.getComputedStyle(curr);
      const bg = c.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        return rgbStringToHex(bg, '#0E0D15');
      }
      const bgImg = c.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        const stopMatch = bgImg.match(
          /(?:oklab|oklch|rgba?|hsla?|color)\([^)]+\)|#[0-9a-fA-F]{3,8}/i
        );
        if (stopMatch) {
          return rgbStringToHex(stopMatch[0], '#A855F7');
        }
      }
      curr = curr.parentElement;
    }
  } catch {
    // Ignore
  }
  return '#0E0D15';
}

/**
 * Replaces an SVG icon (either the selected <svg> itself or the <svg> inside a button/layer)
 * with a preset vector icon or custom SVG markup, and optionally sets its color.
 */
export function updateDomLayerIcon(
  doc: Document,
  layerId: string,
  options: {
    presetId?: string;
    customSvg?: string;
    iconColor?: string;
  }
): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return false;

  const targetSvg =
    el.tagName.toLowerCase() === 'svg'
      ? (el as unknown as SVGSVGElement)
      : (el.querySelector('svg') as SVGSVGElement | null);

  if (!targetSvg) return false;

  if (options.presetId) {
    const preset = BUILDER_ICON_PRESETS.find((p) => p.id === options.presetId);
    if (preset) {
      targetSvg.setAttribute('viewBox', preset.viewBox || '0 0 24 24');
      targetSvg.setAttribute('fill', 'none');
      targetSvg.setAttribute('stroke', 'currentColor');
      targetSvg.setAttribute('stroke-width', '2');
      targetSvg.setAttribute('stroke-linecap', 'round');
      targetSvg.setAttribute('stroke-linejoin', 'round');
      targetSvg.innerHTML = preset.svgInner;
      el.setAttribute('data-ag-icon-preset', preset.id);
      el.removeAttribute('data-ag-custom-svg');
    }
  } else if (options.customSvg && options.customSvg.trim().length > 0) {
    const raw = options.customSvg.trim();
    if (raw.startsWith('<svg')) {
      const temp = doc.createElement('div');
      temp.innerHTML = raw;
      const parsedSvg = temp.querySelector('svg');
      if (parsedSvg) {
        targetSvg.setAttribute('viewBox', parsedSvg.getAttribute('viewBox') || '0 0 24 24');
        targetSvg.innerHTML = parsedSvg.innerHTML;
      }
    } else {
      targetSvg.innerHTML = raw;
    }
    el.setAttribute('data-ag-custom-svg', raw);
    el.removeAttribute('data-ag-icon-preset');
  }

  if (options.iconColor) {
    targetSvg.style.color = options.iconColor;
    targetSvg.style.stroke = options.iconColor;
    el.setAttribute('data-ag-icon-color', options.iconColor);
  }

  return true;
}

/**
 * Applies drag/move (dx, dy in px or %), responsive or pixel resize (width, height, %, rem, vw, presets),
 * and zIndex directly to the live DOM node.
 */
export function applyLayerTransformToDom(
  doc: Document,
  layerId: string,
  patch: Partial<DesignLayerTransform>
): DesignLayerNode | null {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return null;

  const prevDx = parseInt(el.getAttribute('data-ag-dx') || '0', 10) || 0;
  const prevDy = parseInt(el.getAttribute('data-ag-dy') || '0', 10) || 0;
  const r = el.getBoundingClientRect();
  const parentRect = el.parentElement?.getBoundingClientRect();
  const parentW = Math.round(parentRect?.width || 360);

  const prevW = parseInt(el.getAttribute('data-ag-w') || String(Math.round(r.width)), 10);
  const prevH = parseInt(el.getAttribute('data-ag-h') || String(Math.round(r.height)), 10);
  const prevZ = parseInt(el.getAttribute('data-ag-z') || '0', 10) || 0;
  const prevUnit = (el.getAttribute('data-ag-w-unit') || '%') as ResponsiveSizingUnit;
  const prevHeightUnit = (el.getAttribute('data-ag-h-unit') ||
    (prevUnit === '%' ? 'auto' : 'px')) as 'auto' | 'px' | '%';
  const prevOffsetUnit = (el.getAttribute('data-ag-offset-unit') ||
    (prevUnit === '%' ? '%' : 'px')) as '%' | 'px';
  const prevPreset = (el.getAttribute('data-ag-resp-preset') || 'none') as ResponsiveLayoutPreset;
  const prevFlow = el.getAttribute('data-ag-flow-space') === 'true';
  const prevBoxAlign = (el.getAttribute('data-ag-box-align') || 'none') as LayerBoxAlign;
  const prevContentAlign = (el.getAttribute('data-ag-content-align') || 'none') as LayerContentAlign;

  const nextDx = patch.dx !== undefined ? patch.dx : prevDx;
  const nextDy = patch.dy !== undefined ? patch.dy : prevDy;
  const nextW = patch.width !== undefined ? patch.width : prevW;
  const nextH = patch.height !== undefined ? patch.height : prevH;
  const nextZ = patch.zIndex !== undefined ? patch.zIndex : prevZ;
  const nextUnit = patch.widthUnit !== undefined ? patch.widthUnit : prevUnit;
  const nextHeightUnit =
    patch.heightUnit !== undefined
      ? patch.heightUnit
      : patch.widthUnit !== undefined
      ? patch.widthUnit === '%'
        ? 'auto'
        : 'px'
      : prevHeightUnit;
  const nextOffsetUnit =
    patch.offsetUnit !== undefined
      ? patch.offsetUnit
      : patch.widthUnit !== undefined
      ? patch.widthUnit === '%'
        ? '%'
        : 'px'
      : prevOffsetUnit;
  const nextPreset = patch.responsivePreset !== undefined ? patch.responsivePreset : prevPreset;
  const nextFlow = patch.useFlowSpacing !== undefined ? patch.useFlowSpacing : prevFlow;
  const nextBoxAlign = patch.boxAlign !== undefined ? patch.boxAlign : prevBoxAlign;
  const nextContentAlign =
    patch.contentAlign !== undefined ? patch.contentAlign : prevContentAlign;

  const nextPct =
    patch.widthPercent !== undefined
      ? patch.widthPercent
      : computeResponsiveWidthPercent(nextW, parentW);
  const nextDxPct =
    patch.dxPercent !== undefined
      ? patch.dxPercent
      : computeResponsiveOffsetPercent(nextDx, parentW);

  el.setAttribute('data-ag-dx', String(nextDx));
  el.setAttribute('data-ag-dy', String(nextDy));
  el.setAttribute('data-ag-w', String(nextW));
  el.setAttribute('data-ag-h', String(nextH));
  el.setAttribute('data-ag-z', String(nextZ));
  el.setAttribute('data-ag-w-unit', nextUnit);
  el.setAttribute('data-ag-w-pct', String(nextPct));
  el.setAttribute('data-ag-h-unit', nextHeightUnit);
  el.setAttribute('data-ag-offset-unit', nextOffsetUnit);
  el.setAttribute('data-ag-dx-pct', String(nextDxPct));
  el.setAttribute('data-ag-resp-preset', nextPreset);
  el.setAttribute('data-ag-flow-space', String(nextFlow));
  el.setAttribute('data-ag-box-align', nextBoxAlign);
  el.setAttribute('data-ag-content-align', nextContentAlign);

  // Position: Flow Margin vs Translate3d, supporting both relative % and fixed px
  if (nextDx !== 0 || nextDy !== 0) {
    const xCss = nextOffsetUnit === '%' ? `${nextDxPct}%` : `${nextDx}px`;
    if (nextFlow) {
      el.style.transform = '';
      el.style.marginLeft = xCss;
      el.style.marginTop = `${nextDy}px`;
    } else {
      el.style.marginLeft = '';
      el.style.marginTop = '';
      el.style.transform = `translate3d(${xCss}, ${nextDy}px, 0)`;
    }
  } else {
    el.style.transform = '';
    el.style.marginLeft = '';
    el.style.marginTop = '';
  }

  // Box Alignment inside Parent Container (Left, Center, Right, Stretch)
  if (nextBoxAlign && nextBoxAlign !== 'none') {
    const computedDisp = getComputedStyle(el).display;
    if (computedDisp === 'inline') {
      el.style.display = 'block';
    }
    // If element is a text leaf or button at 100% default width without explicit width resize, use fit-content so it visibly aligns inside parent
    if (
      nextBoxAlign !== 'stretch' &&
      el.children.length === 0 &&
      patch.width === undefined &&
      nextPct >= 98
    ) {
      el.style.width = 'fit-content';
    }

    if (nextBoxAlign === 'left') {
      el.style.marginLeft = '0px';
      el.style.marginRight = 'auto';
      el.style.alignSelf = 'flex-start';
    } else if (nextBoxAlign === 'center') {
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
      el.style.alignSelf = 'center';
    } else if (nextBoxAlign === 'right') {
      el.style.marginLeft = 'auto';
      el.style.marginRight = '0px';
      el.style.alignSelf = 'flex-end';
    } else if (nextBoxAlign === 'stretch') {
      el.style.marginLeft = '0px';
      el.style.marginRight = '0px';
      el.style.width = '100%';
      el.style.maxWidth = '100%';
      el.style.alignSelf = 'stretch';
    }
  } else if (patch.boxAlign === 'none') {
    el.style.marginRight = '';
    el.style.alignSelf = '';
  }

  // Content & Text Alignment inside Element (Left, Center, Right, Space-Between)
  if (nextContentAlign && nextContentAlign !== 'none') {
    const isFlex = getComputedStyle(el).display.includes('flex');
    if (nextContentAlign === 'left') {
      el.style.textAlign = 'left';
      if (isFlex) el.style.justifyContent = 'flex-start';
    } else if (nextContentAlign === 'center') {
      el.style.textAlign = 'center';
      if (isFlex) el.style.justifyContent = 'center';
    } else if (nextContentAlign === 'right') {
      el.style.textAlign = 'right';
      if (isFlex) el.style.justifyContent = 'flex-end';
    } else if (nextContentAlign === 'between') {
      el.style.display = 'flex';
      el.style.justifyContent = 'space-between';
      el.style.alignItems = 'center';
      el.style.width = '100%';
    }
  } else if (patch.contentAlign === 'none') {
    el.style.textAlign = '';
    el.style.justifyContent = '';
  }

  // Responsive Preset or Unit Width (% vs px vs rem vs vw)
  if (patch.responsivePreset !== undefined && nextPreset !== 'none') {
    if (nextPreset === 'w-full') {
      el.style.width = '100%';
      el.style.maxWidth = '100%';
      el.style.flex = '';
    } else if (nextPreset === 'w-auto') {
      el.style.width = 'auto';
      el.style.maxWidth = '100%';
      el.style.flex = '';
    } else if (nextPreset === 'flex-1') {
      el.style.width = 'auto';
      el.style.flex = '1 1 0%';
      el.style.minWidth = '0px';
    } else if (nextPreset === 'w-1/2') {
      el.style.width = '50%';
      el.style.maxWidth = '100%';
      el.style.flex = '';
    } else if (nextPreset === 'w-90-center') {
      el.style.width = '90%';
      el.style.maxWidth = '100%';
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
    }
  } else if (
    patch.width !== undefined ||
    patch.widthPercent !== undefined ||
    patch.widthUnit !== undefined
  ) {
    if (nextUnit === '%') {
      el.style.width = `${nextPct}%`;
      el.style.maxWidth = '100%';
      el.style.flex = '';
    } else if (nextUnit === 'rem') {
      el.style.width = `${(nextW / 16).toFixed(2)}rem`;
      el.style.maxWidth = '100%';
    } else if (nextUnit === 'vw') {
      const vw = Math.max(10, Math.min(100, Math.round((nextW / 393) * 100)));
      el.style.width = `${vw}vw`;
      el.style.maxWidth = '100%';
    } else if (nextUnit === 'auto') {
      el.style.width = 'auto';
      el.style.maxWidth = '100%';
    } else if (nextW > 0) {
      el.style.width = `${nextW}px`;
      el.style.maxWidth = 'none';
    }
  }

  // Height: Adaptive 'auto' (with minHeight) vs Fixed 'px'
  if (patch.height !== undefined || patch.heightUnit !== undefined || patch.widthUnit !== undefined) {
    if (nextHeightUnit === 'auto') {
      el.style.height = 'auto';
      if (patch.height !== undefined && nextH > 0) {
        el.style.minHeight = `${nextH}px`;
      }
    } else if (nextUnit === 'rem' && nextH > 0) {
      el.style.height = 'auto';
      el.style.minHeight = `${(nextH / 16).toFixed(2)}rem`;
    } else if (nextH > 0) {
      el.style.height = `${nextH}px`;
      el.style.minHeight = '';
    }
  }

  if (patch.zIndex !== undefined) {
    if (nextZ !== 0) {
      if (getComputedStyle(el).position === 'static') {
        el.style.position = 'relative';
      }
      el.style.zIndex = String(nextZ);
    } else {
      el.style.zIndex = '';
    }
  }

  const all = extractIframeDesignLayers(doc);
  return all.find((l) => l.id === layerId) || null;
}

/**
 * Physically swaps a DOM layer with its previous ('up') or next ('down') sibling in the live DOM.
 */
export function swapDomLayerOrder(
  doc: Document,
  layerId: string,
  direction: 'up' | 'down'
): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el || !el.parentElement) return false;
  const parent = el.parentElement;

  if (direction === 'up') {
    const prev = el.previousElementSibling as HTMLElement | null;
    if (!prev || prev.id?.startsWith('__antigravity')) return false;
    parent.insertBefore(el, prev);
    return true;
  } else {
    const next = el.nextElementSibling as HTMLElement | null;
    if (!next || next.id?.startsWith('__antigravity')) return false;
    parent.insertBefore(next, el);
    return true;
  }
}

/**
 * Groups multiple DOM layers into a new movable/resizable flex container in the live iframe DOM.
 */
export function groupDomLayers(
  doc: Document,
  layerIds: string[],
  customGroupName?: string
): string | null {
  const elements = layerIds
    .map((id) => findDomElementByLayerId(doc, id))
    .filter((el): el is HTMLElement => Boolean(el));

  if (elements.length < 2) return null;

  const firstEl = elements[0];
  const parent = firstEl.parentElement;
  if (!parent) return null;

  const groupId = `layer-group-${groupCounter}`;
  const groupName = customGroupName || `Group_${groupCounter}`;
  groupCounter++;

  const wrapper = doc.createElement('div');
  wrapper.setAttribute('data-ag-group', 'true');
  wrapper.setAttribute('data-component', groupName);
  wrapper.setAttribute('data-ag-layer-id', groupId);
  wrapper.style.border = '1.5px dashed rgba(184, 51, 255, 0.65)';
  wrapper.style.borderRadius = '20px';
  wrapper.style.padding = '8px';
  wrapper.style.background = 'rgba(184, 51, 255, 0.04)';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '8px';
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  wrapper.style.maxWidth = '100%';

  parent.insertBefore(wrapper, firstEl);
  elements.forEach((el) => {
    wrapper.appendChild(el);
  });

  const r = wrapper.getBoundingClientRect();
  wrapper.setAttribute('data-ag-init-x', String(Math.round(r.left)));
  wrapper.setAttribute('data-ag-init-y', String(Math.round(r.top)));
  wrapper.setAttribute('data-ag-init-w', String(Math.round(r.width)));
  wrapper.setAttribute('data-ag-init-h', String(Math.round(r.height)));

  return groupId;
}

/**
 * Ungroups a group container layer, moving its child layers back into the parent container.
 */
export function ungroupDomLayer(doc: Document, groupLayerId: string): boolean {
  const wrapper = findDomElementByLayerId(doc, groupLayerId);
  if (!wrapper || wrapper.getAttribute('data-ag-group') !== 'true') return false;
  const parent = wrapper.parentElement;
  if (!parent) return false;

  const children = Array.from(wrapper.children) as HTMLElement[];
  children.forEach((child) => {
    parent.insertBefore(child, wrapper);
  });
  wrapper.remove();
  return true;
}

/**
 * Duplicates a DOM layer right after the original node.
 */
export function duplicateDomLayer(doc: Document, layerId: string): string | null {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el || !el.parentElement) return null;

  const clone = el.cloneNode(true) as HTMLElement;
  const baseName = el.getAttribute('data-component') || el.tagName.toLowerCase();
  const newName = `${baseName}_Copy${cloneCounter}`;
  const newId = `layer-${newName}-${cloneCounter}`;
  cloneCounter++;

  clone.setAttribute('data-component', newName);
  clone.setAttribute('data-ag-layer-id', newId);
  el.parentElement.insertBefore(clone, el.nextSibling);
  return newId;
}

export function toggleDomLayerVisibility(doc: Document, layerId: string): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return true;
  const currentlyHidden = el.getAttribute('data-ag-hidden') === 'true';
  if (currentlyHidden) {
    el.removeAttribute('data-ag-hidden');
    el.style.display = el.getAttribute('data-ag-prev-display') || '';
    return true;
  } else {
    el.setAttribute('data-ag-prev-display', el.style.display || '');
    el.setAttribute('data-ag-hidden', 'true');
    el.style.display = 'none';
    return false;
  }
}

export function restoreAllDomHiddenLayers(doc: Document): number {
  const allHidden = Array.from(doc.querySelectorAll('[data-ag-hidden="true"]')) as HTMLElement[];
  allHidden.forEach((el) => {
    el.removeAttribute('data-ag-hidden');
    el.style.display = el.getAttribute('data-ag-prev-display') || '';
    el.removeAttribute('data-ag-prev-display');
  });
  return allHidden.length;
}

export function countDomHiddenLayers(doc: Document): number {
  return doc.querySelectorAll('[data-ag-hidden="true"]').length;
}

export function toggleDomLayerLock(doc: Document, layerId: string): boolean {
  const el = findDomElementByLayerId(doc, layerId);
  if (!el) return false;
  const currentlyLocked = el.getAttribute('data-ag-locked') === 'true';
  if (currentlyLocked) {
    el.removeAttribute('data-ag-locked');
    return false;
  } else {
    el.setAttribute('data-ag-locked', 'true');
    return true;
  }
}

export function resetAllDomLayerTransforms(doc: Document): void {
  const all = Array.from(doc.querySelectorAll('[data-ag-layer-id]')) as HTMLElement[];
  all.forEach((el) => {
    el.removeAttribute('data-ag-dx');
    el.removeAttribute('data-ag-dy');
    el.removeAttribute('data-ag-w');
    el.removeAttribute('data-ag-h');
    el.removeAttribute('data-ag-z');
    el.removeAttribute('data-ag-w-pct');
    el.removeAttribute('data-ag-h-unit');
    el.removeAttribute('data-ag-offset-unit');
    el.removeAttribute('data-ag-dx-pct');
    el.removeAttribute('data-ag-resp-preset');
    el.removeAttribute('data-ag-flow-space');
    el.removeAttribute('data-ag-box-align');
    el.removeAttribute('data-ag-content-align');
    el.removeAttribute('data-ag-hidden');
    el.removeAttribute('data-ag-locked');
    el.style.transform = '';
    el.style.marginLeft = '';
    el.style.marginRight = '';
    el.style.marginTop = '';
    el.style.alignSelf = '';
    el.style.textAlign = '';
    el.style.justifyContent = '';
    el.style.width = '';
    el.style.height = '';
    el.style.minHeight = '';
    el.style.maxWidth = '';
    el.style.flex = '';
    el.style.zIndex = '';
    el.style.display = el.getAttribute('data-ag-prev-display') || '';
    const initText = el.getAttribute('data-ag-init-text');
    if (initText) {
      updateDomLayerText(doc, el.getAttribute('data-ag-layer-id') || '', initText);
    }
  });
}

/**
 * Renders and binds an interactive Website-Builder Bounding Box Gizmo (with 8 resize handles + drag-to-move
 * + click-to-select any nested element + double-click inline text edit) inside the preview iframe.
 */
export function syncBuilderGizmoInIframe(
  doc: Document,
  activeLayerId: string | null,
  snapGridSize: number,
  onTransformChange: (
    layerId: string,
    patch: Partial<DesignLayerTransform>,
    opType: 'move' | 'resize'
  ) => void,
  onSelectLayerFromCanvas?: (layerId: string) => void,
  onInlineTextChange?: (layerId: string, newText: string) => void
): void {
  const GIZMO_ID = '__antigravity_builder_gizmo__';
  let gizmo = doc.getElementById(GIZMO_ID) as HTMLElement | null;

  const docWithFlag = doc as Document & {
    __agBuilderClickBound?: boolean;
    __agSelectCb?: (id: string) => void;
    __agTextCb?: (id: string, txt: string) => void;
  };
  docWithFlag.__agSelectCb = onSelectLayerFromCanvas;
  docWithFlag.__agTextCb = onInlineTextChange;

  if (!docWithFlag.__agBuilderClickBound) {
    docWithFlag.__agBuilderClickBound = true;

    doc.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (doc.body?.getAttribute('data-ag-eyedropper-active') === 'true') return;
        const target = e.target as HTMLElement | null;
        if (!target || target.closest(`#${GIZMO_ID}`) || target.id?.startsWith('__antigravity')) return;

        let layerEl = target.closest('[data-ag-layer-id]') as HTMLElement | null;
        if (!layerEl && target !== doc.body && target.tagName !== 'HTML') {
          ensureLayerAttributes(target, 0);
          layerEl = target;
        }
        if (layerEl && docWithFlag.__agSelectCb) {
          e.preventDefault();
          e.stopPropagation();
          const lid = layerEl.getAttribute('data-ag-layer-id');
          if (lid) {
            docWithFlag.__agSelectCb(lid);
          }
        }
      },
      true
    );

    doc.addEventListener(
      'dblclick',
      (e: MouseEvent) => {
        if (doc.body?.getAttribute('data-ag-eyedropper-active') === 'true') return;
        if (!doc.getElementById(GIZMO_ID)) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const layerEl = (
          target.closest(`#${GIZMO_ID}`)
            ? findDomElementByLayerId(
                doc,
                doc.getElementById(GIZMO_ID)?.getAttribute('data-target-layer') || ''
              )
            : (target.closest('[data-ag-layer-id]') as HTMLElement | null)
        ) as HTMLElement | null;

        if (!layerEl) return;
        const lid = layerEl.getAttribute('data-ag-layer-id');
        if (!lid) return;

        e.preventDefault();
        e.stopPropagation();
        layerEl.contentEditable = 'true';
        layerEl.style.outline = '2px solid #10B981';
        layerEl.focus();

        const finishInlineEdit = () => {
          layerEl.contentEditable = 'false';
          layerEl.style.outline = '';
          const newTxt = hasDirectTextNode(layerEl) || layerEl.innerText.trim();
          if (docWithFlag.__agTextCb && newTxt) {
            docWithFlag.__agTextCb(lid, newTxt);
          }
          layerEl.removeEventListener('blur', finishInlineEdit);
        };
        layerEl.addEventListener('blur', finishInlineEdit);
      },
      true
    );
  }

  if (!activeLayerId) {
    if (gizmo) gizmo.remove();
    return;
  }

  const targetEl = findDomElementByLayerId(doc, activeLayerId);
  if (!targetEl || targetEl.getAttribute('data-ag-hidden') === 'true') {
    if (gizmo) gizmo.remove();
    return;
  }

  if (!gizmo) {
    gizmo = doc.createElement('div');
    gizmo.id = GIZMO_ID;
    gizmo.style.position = 'fixed';
    gizmo.style.zIndex = '2147483645';
    gizmo.style.border = '2px solid #B833FF';
    gizmo.style.background = 'rgba(184, 51, 255, 0.08)';
    gizmo.style.borderRadius = '10px';
    gizmo.style.boxSizing = 'border-box';
    gizmo.style.cursor = 'move';
    gizmo.style.userSelect = 'none';
    gizmo.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.25), 0 8px 24px rgba(184,51,255,0.25)';

    const badge = doc.createElement('div');
    badge.id = `${GIZMO_ID}_badge`;
    badge.style.position = 'absolute';
    badge.style.top = '-24px';
    badge.style.left = '-2px';
    badge.style.background = '#B833FF';
    badge.style.color = '#FFFFFF';
    badge.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = '700';
    badge.style.padding = '2px 7px';
    badge.style.borderRadius = '6px';
    badge.style.whiteSpace = 'nowrap';
    badge.style.pointerEvents = 'none';
    badge.style.boxShadow = '0 4px 10px rgba(0,0,0,0.35)';
    gizmo.appendChild(badge);

    const handles: Array<{
      dir: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      pos: Record<string, string>;
      cursor: string;
    }> = [
      { dir: 'nw', pos: { top: '-5px', left: '-5px' }, cursor: 'nwse-resize' },
      { dir: 'n', pos: { top: '-5px', left: 'calc(50% - 5px)' }, cursor: 'ns-resize' },
      { dir: 'ne', pos: { top: '-5px', right: '-5px' }, cursor: 'nesw-resize' },
      { dir: 'e', pos: { top: 'calc(50% - 5px)', right: '-5px' }, cursor: 'ew-resize' },
      { dir: 'se', pos: { bottom: '-5px', right: '-5px' }, cursor: 'nwse-resize' },
      { dir: 's', pos: { bottom: '-5px', left: 'calc(50% - 5px)' }, cursor: 'ns-resize' },
      { dir: 'sw', pos: { bottom: '-5px', left: '-5px' }, cursor: 'nesw-resize' },
      { dir: 'w', pos: { top: 'calc(50% - 5px)', left: '-5px' }, cursor: 'ew-resize' },
    ];

    handles.forEach((h) => {
      const dot = doc.createElement('div');
      dot.setAttribute('data-resize-dir', h.dir);
      dot.style.position = 'absolute';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.background = '#FFFFFF';
      dot.style.border = '2px solid #B833FF';
      dot.style.borderRadius = '3px';
      dot.style.cursor = h.cursor;
      dot.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
      Object.entries(h.pos).forEach(([k, v]) => {
        dot.style.setProperty(k, v);
      });
      gizmo!.appendChild(dot);
    });

    doc.body.appendChild(gizmo);
  }

  gizmo.setAttribute('data-target-layer', activeLayerId);

  const updateGizmoBounds = () => {
    const r = targetEl.getBoundingClientRect();
    if (!gizmo) return;
    gizmo.style.top = `${r.top}px`;
    gizmo.style.left = `${r.left}px`;
    gizmo.style.width = `${r.width}px`;
    gizmo.style.height = `${r.height}px`;

    const wUnit = (targetEl.getAttribute('data-ag-w-unit') || '%') as ResponsiveSizingUnit;
    const parentW = Math.round(targetEl.parentElement?.getBoundingClientRect().width || 360);
    const pct = computeResponsiveWidthPercent(Math.round(r.width), parentW);
    const compName = targetEl.getAttribute('data-component') || targetEl.tagName.toLowerCase();
    const isLocked = targetEl.getAttribute('data-ag-locked') === 'true';
    const badge = doc.getElementById(`${GIZMO_ID}_badge`);
    if (badge) {
      const sizeStr =
        wUnit === '%'
          ? `${pct}% (${Math.round(r.width)}px) [%]`
          : `${Math.round(r.width)}×${Math.round(r.height)}px [px]`;
      badge.textContent = `${isLocked ? '🔒 ' : '✥ '}${compName} · ${sizeStr}`;
    }
  };

  updateGizmoBounds();

  gizmo.onmousedown = (downEvent: MouseEvent) => {
    downEvent.preventDefault();
    downEvent.stopPropagation();

    if (targetEl.getAttribute('data-ag-locked') === 'true') return;

    const handleTarget = downEvent.target as HTMLElement;
    const resizeDir = handleTarget.getAttribute('data-resize-dir') as
      | 'nw'
      | 'n'
      | 'ne'
      | 'e'
      | 'se'
      | 's'
      | 'sw'
      | 'w'
      | null;

    const startMouseX = downEvent.clientX;
    const startMouseY = downEvent.clientY;
    const rectNow = targetEl.getBoundingClientRect();
    const parentW = Math.round(targetEl.parentElement?.getBoundingClientRect().width || 360);
    const startDx = parseInt(targetEl.getAttribute('data-ag-dx') || '0', 10) || 0;
    const startDy = parseInt(targetEl.getAttribute('data-ag-dy') || '0', 10) || 0;
    const startW = Math.round(rectNow.width);
    const startH = Math.round(rectNow.height);
    const wUnit = (targetEl.getAttribute('data-ag-w-unit') || '%') as ResponsiveSizingUnit;
    const isVerticalResize = Boolean(resizeDir && (resizeDir.includes('n') || resizeDir.includes('s')));

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX;
      const deltaY = moveEvent.clientY - startMouseY;

      if (resizeDir) {
        const nextBox = computeResizedBox(
          { dx: startDx, dy: startDy, width: startW, height: startH },
          resizeDir,
          deltaX,
          deltaY,
          snapGridSize
        );
        const pct = computeResponsiveWidthPercent(nextBox.width, parentW);
        const dxPct = computeResponsiveOffsetPercent(nextBox.dx, parentW);
        applyLayerTransformToDom(doc, activeLayerId, {
          ...nextBox,
          widthUnit: wUnit,
          widthPercent: pct,
          heightUnit: wUnit === '%' && !isVerticalResize ? 'auto' : 'px',
          offsetUnit: wUnit === '%' ? '%' : 'px',
          dxPercent: dxPct,
          responsivePreset: 'none',
        });
        updateGizmoBounds();
      } else {
        const nextDx =
          snapGridSize > 1
            ? Math.round((startDx + deltaX) / snapGridSize) * snapGridSize
            : Math.round(startDx + deltaX);
        const nextDy =
          snapGridSize > 1
            ? Math.round((startDy + deltaY) / snapGridSize) * snapGridSize
            : Math.round(startDy + deltaY);
        const dxPct = computeResponsiveOffsetPercent(nextDx, parentW);
        applyLayerTransformToDom(doc, activeLayerId, {
          dx: nextDx,
          dy: nextDy,
          offsetUnit: wUnit === '%' ? '%' : 'px',
          dxPercent: dxPct,
        });
        updateGizmoBounds();
      }
    };

    const onMouseUp = () => {
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseup', onMouseUp);

      const finalDx = parseInt(targetEl.getAttribute('data-ag-dx') || '0', 10) || 0;
      const finalDy = parseInt(targetEl.getAttribute('data-ag-dy') || '0', 10) || 0;
      const finalW = parseInt(targetEl.getAttribute('data-ag-w') || String(startW), 10);
      const finalH = parseInt(targetEl.getAttribute('data-ag-h') || String(startH), 10);
      const finalPct = computeResponsiveWidthPercent(finalW, parentW);
      const finalDxPct = computeResponsiveOffsetPercent(finalDx, parentW);

      onTransformChange(
        activeLayerId,
        {
          dx: finalDx,
          dy: finalDy,
          width: finalW,
          height: finalH,
          widthUnit: wUnit,
          widthPercent: finalPct,
          heightUnit: wUnit === '%' && !isVerticalResize ? 'auto' : 'px',
          offsetUnit: wUnit === '%' ? '%' : 'px',
          dxPercent: finalDxPct,
        },
        resizeDir ? 'resize' : 'move'
      );
    };

    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', onMouseUp);
  };
}
