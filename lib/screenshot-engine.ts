import { extractIframeDesignLayers, findDomElementByLayerId, sampleElementColorFromDom } from './dom-layer-engine';
import { doesRectIntersectCrop, rgbStringToHex } from './layer-builder';

export interface CapturedTechnicalObject {
  index: number;
  layerId: string;
  name: string;
  tag: string;
  textSnippet: string;
  rect: { x: number; y: number; width: number; height: number };
  colorHex: string;
  bgHex: string;
  sourceFile?: string;
  sourceLine?: number;
  selector: string;
}

export interface VisualTechnicalScreenshotResult {
  id: string;
  timestamp: string;
  deviceName: string;
  mode: 'full' | 'region';
  cropRect: { x: number; y: number; width: number; height: number };
  dataUrl: string;
  visualOnlyDataUrl: string;
  objects: CapturedTechnicalObject[];
  markdownReport: string;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  measuredHeight: number,
  lineHeight: number,
  textAlign: string
) {
  // If browser rendered this text node on a single line, draw it on a single line without wrapping
  if (measuredHeight <= lineHeight * 1.55) {
    let drawX = x;
    if (textAlign === 'center') {
      const w = ctx.measureText(text).width;
      drawX = x + Math.max(0, (maxWidth - w) / 2);
    } else if (textAlign === 'right' || textAlign === 'end') {
      const w = ctx.measureText(text).width;
      drawX = x + Math.max(0, maxWidth - w);
    }
    ctx.fillText(text, drawX, y);
    return;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + ' ' + words[i];
    if (ctx.measureText(testLine).width <= maxWidth + 14) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);

  lines.forEach((line, idx) => {
    let drawX = x;
    if (textAlign === 'center') {
      const w = ctx.measureText(line).width;
      drawX = x + Math.max(0, (maxWidth - w) / 2);
    } else if (textAlign === 'right' || textAlign === 'end') {
      const w = ctx.measureText(line).width;
      drawX = x + Math.max(0, maxWidth - w);
    }
    ctx.fillText(line, drawX, y + idx * lineHeight);
  });
}

function drawSvgElementOnCanvas(
  ctx: CanvasRenderingContext2D,
  svgEl: SVGSVGElement,
  relX: number,
  relY: number,
  width: number,
  height: number,
  win: Window
) {
  if (typeof Path2D === 'undefined') return;
  try {
    const vbAttr = svgEl.getAttribute('viewBox') || '0 0 24 24';
    const vbParts = vbAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const vbW = vbParts[2] || 24;
    const vbH = vbParts[3] || 24;

    const comp = win.getComputedStyle(svgEl);
    const strokeColor =
      comp.stroke && comp.stroke !== 'none' ? comp.stroke : comp.color || '#FFFFFF';
    const fillColor = comp.fill && comp.fill !== 'none' ? comp.fill : 'none';
    const strokeWidth = parseFloat(svgEl.getAttribute('stroke-width') || comp.strokeWidth || '2') || 2;

    ctx.save();
    ctx.translate(relX, relY);
    ctx.scale(width / vbW, height / vbH);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    if (fillColor !== 'none' && fillColor !== 'rgb(0, 0, 0)') {
      ctx.fillStyle = fillColor;
    }

    const paths = Array.from(svgEl.querySelectorAll('path'));
    paths.forEach((p) => {
      const d = p.getAttribute('d');
      if (!d) return;
      const p2d = new Path2D(d);
      const pComp = win.getComputedStyle(p);
      if (
        pComp.fill &&
        pComp.fill !== 'none' &&
        pComp.fill !== 'rgba(0, 0, 0, 0)' &&
        svgEl.getAttribute('fill') !== 'none'
      ) {
        ctx.fillStyle = pComp.fill;
        ctx.fill(p2d);
      }
      ctx.stroke(p2d);
    });

    const polygons = Array.from(svgEl.querySelectorAll('polygon'));
    polygons.forEach((poly) => {
      const pts = (poly.getAttribute('points') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (pts.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
          ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.closePath();
        ctx.stroke();
      }
    });

    const circles = Array.from(svgEl.querySelectorAll('circle'));
    circles.forEach((c) => {
      const cx = parseFloat(c.getAttribute('cx') || '12');
      const cy = parseFloat(c.getAttribute('cy') || '12');
      const r = parseFloat(c.getAttribute('r') || '5');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.restore();
  } catch {
    // Ignore SVG path error
  }
}

function paintDomVisualToCanvas(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  safeCrop: { x: number; y: number; width: number; height: number },
  viewX: number,
  viewY: number
) {
  const win = doc.defaultView || window;
  const rootApp =
    (doc.querySelector('[data-component="DemoApp"]') as HTMLElement | null) || doc.body;

  // Base dark background of the mini app
  ctx.fillStyle = '#0F0E17';
  ctx.fillRect(viewX, viewY, safeCrop.width, safeCrop.height);

  // Collect all visible elements inside the app in DOM painting order
  const allDomElements = Array.from(rootApp.querySelectorAll('*')) as HTMLElement[];

  allDomElements.forEach((el) => {
    if (!el || el.id?.startsWith('__antigravity')) return;
    if (el.closest('#__antigravity_builder_gizmo__')) return;
    if (el.closest('[data-nextjs-dev-tools-button]')) return;
    if (el.getAttribute('aria-label') === 'Open Next.js Dev Tools') return;

    const tag = el.tagName.toLowerCase();
    if (['path', 'polygon', 'circle', 'defs', 'style', 'script'].includes(tag)) return;

    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return;
    if (
      !doesRectIntersectCrop(
        { x: r.left, y: r.top, width: r.width, height: r.height },
        safeCrop
      )
    ) {
      return;
    }

    const comp = win.getComputedStyle(el);
    if (comp.display === 'none' || comp.visibility === 'hidden' || parseFloat(comp.opacity || '1') === 0) {
      return;
    }

    const relX = viewX + (r.left - safeCrop.x);
    const relY = viewY + (r.top - safeCrop.y);
    const rad = Math.min(
      Math.min(r.width, r.height) / 2,
      parseFloat(comp.borderTopLeftRadius || '0') || 0
    );

    // 1. Paint Element Background (Solid or Linear Gradient)
    const hasBgImg = comp.backgroundImage && comp.backgroundImage !== 'none';
    const hasBgColor =
      comp.backgroundColor &&
      comp.backgroundColor !== 'transparent' &&
      comp.backgroundColor !== 'rgba(0, 0, 0, 0)';

    if (hasBgImg || hasBgColor) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(relX, relY, r.width, r.height, rad);

      if (hasBgImg && comp.backgroundImage.includes('gradient')) {
        const rgbMatches = comp.backgroundImage.match(
          /(?:oklab|oklch|rgba?|hsla?|color)\([^)]+\)|#[0-9a-fA-F]{3,8}/gi
        );
        const grad = ctx.createLinearGradient(relX, relY, relX + r.width, relY + r.height);
        if (rgbMatches && rgbMatches.length >= 2) {
          rgbMatches.forEach((stopColor, sIdx) => {
            grad.addColorStop(sIdx / (rgbMatches.length - 1), rgbStringToHex(stopColor, '#3B1D7A'));
          });
        } else {
          grad.addColorStop(0, '#3B1D7A');
          grad.addColorStop(0.55, '#241445');
          grad.addColorStop(1, '#131122');
        }
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = comp.backgroundColor;
      }
      ctx.fill();
      ctx.restore();
    }

    // 2. Paint Element Border
    const borderW = parseFloat(comp.borderTopWidth || '0') || 0;
    if (borderW > 0 && comp.borderTopStyle !== 'none') {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(relX, relY, r.width, r.height, rad);
      ctx.strokeStyle = comp.borderTopColor || 'rgba(255,255,255,0.12)';
      ctx.lineWidth = Math.min(2, borderW);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Paint <svg> Icons
    if (tag === 'svg') {
      drawSvgElementOnCanvas(
        ctx,
        el as unknown as SVGSVGElement,
        relX,
        relY,
        r.width,
        r.height,
        win
      );
      return;
    }

    // 4. Paint <input> Value or Placeholder
    if (tag === 'input') {
      const inp = el as HTMLInputElement;
      const val = inp.value || inp.getAttribute('placeholder') || '';
      if (val) {
        ctx.save();
        const fontSize = parseFloat(comp.fontSize || '12') || 12;
        const padLeft = parseFloat(comp.paddingLeft || '32') || 32;
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = inp.value ? comp.color || '#FFFFFF' : 'rgba(161, 161, 170, 0.75)';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, relX + padLeft, relY + r.height / 2);
        ctx.restore();
      }
      return;
    }

    // 5. Paint Direct Text Nodes inside this Element using exact Range client rects
    el.childNodes.forEach((child) => {
      if (child.nodeType !== 3) return;
      const txt = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;

      try {
        const range = doc.createRange();
        range.selectNodeContents(child);
        const textRect = range.getBoundingClientRect();
        if (textRect.width <= 1 || textRect.height <= 1) return;

        const txtRelX = viewX + (textRect.left - safeCrop.x);
        const txtRelY = viewY + (textRect.top - safeCrop.y);
        const fontSize = parseFloat(comp.fontSize || '12') || 12;
        const lineHeight = parseFloat(comp.lineHeight) || fontSize * 1.32;
        const weight =
          comp.fontWeight === '700' ||
          comp.fontWeight === '800' ||
          comp.fontWeight === '600' ||
          comp.fontWeight === 'bold'
            ? `bold `
            : '';
        const isMono = (comp.fontFamily || '').toLowerCase().includes('mono');

        ctx.save();
        ctx.font = `${weight}${fontSize}px ${
          isMono ? 'ui-monospace, SFMono-Regular, monospace' : 'Inter, system-ui, sans-serif'
        }`;
        ctx.fillStyle =
          el.getAttribute('data-ag-text-color') || comp.color || '#FFFFFF';
        ctx.textBaseline = 'top';

        drawWrappedText(
          ctx,
          txt,
          txtRelX,
          txtRelY + 1,
          Math.max(textRect.width, r.width - 4),
          textRect.height,
          lineHeight,
          comp.textAlign || 'left'
        );
        ctx.restore();
      } catch {
        // Fallback if Range fails
      }
    });
  });
}

function paintSemiTransparentGridOverlay(
  ctx: CanvasRenderingContext2D,
  objects: CapturedTechnicalObject[],
  safeCrop: { x: number; y: number; width: number; height: number },
  viewX: number,
  viewY: number
) {
  objects.forEach((obj) => {
    const relX = viewX + (obj.rect.x - safeCrop.x);
    const relY = viewY + (obj.rect.y - safeCrop.y);

    // Subtle semi-transparent element tint & dashed border over the visual UI
    ctx.save();
    ctx.fillStyle = 'rgba(184, 51, 255, 0.03)';
    ctx.fillRect(relX, relY, obj.rect.width, obj.rect.height);

    ctx.strokeStyle = 'rgba(216, 180, 254, 0.36)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(relX, relY, obj.rect.width, obj.rect.height);
    ctx.setLineDash([]);

    // Compact semi-transparent index tag (#1..#N): place at top-right for text/svg nodes so text start is 100% uncovered
    const labelText = `#${obj.index}`;
    ctx.font = 'bold 8px ui-monospace, SFMono-Regular, monospace';
    const pillW = Math.max(15, Math.round(ctx.measureText(labelText).width) + 5);
    const pillH = 11;
    const isTextOrIcon = Boolean(obj.textSnippet) || obj.tag === 'svg';
    const rawBx = isTextOrIcon ? relX + obj.rect.width - pillW : relX;
    const bx = Math.max(viewX + 1, Math.min(viewX + safeCrop.width - pillW - 1, rawBx));
    const by = Math.max(viewY + 1, Math.min(viewY + safeCrop.height - pillH - 1, relY - 1));

    ctx.fillStyle = 'rgba(15, 14, 23, 0.52)';
    ctx.beginPath();
    ctx.roundRect(bx, by, pillW, pillH, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(216, 180, 254, 0.45)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    ctx.fillStyle = 'rgba(250, 245, 255, 0.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, bx + 2.5, by + pillH / 2 + 0.5);
    ctx.restore();
  });
}

/**
 * Captures a Visual-Technical Screenshot of either the full phone screen or a selected crop region,
 * rendering the full visual design of the app first and overlaying a semi-transparent technical element grid on top.
 */
export function captureVisualTechnicalScreenshot(
  doc: Document,
  cropRect: { x: number; y: number; width: number; height: number },
  deviceName: string,
  mode: 'full' | 'region'
): VisualTechnicalScreenshotResult {
  const win = doc.defaultView || window;
  const allLayers = extractIframeDesignLayers(doc);

  const safeCrop = {
    x: Math.max(0, Math.round(cropRect.x)),
    y: Math.max(0, Math.round(cropRect.y)),
    width: Math.max(40, Math.round(cropRect.width)),
    height: Math.max(40, Math.round(cropRect.height)),
  };

  // Find all visible layers that intersect the captured region
  const intersecting = allLayers.filter(
    (layer) => layer.visible && doesRectIntersectCrop(layer.currentRect, safeCrop)
  );

  const objects: CapturedTechnicalObject[] = intersecting.slice(0, 18).map((layer, idx) => {
    const domEl = findDomElementByLayerId(doc, layer.id);
    let colorHex = layer.textColor || layer.iconColor || '#FFFFFF';
    let bgHex = 'transparent';

    if (domEl) {
      try {
        const comp = win.getComputedStyle(domEl);
        colorHex = sampleElementColorFromDom(domEl, win);
        if (
          comp.backgroundColor &&
          comp.backgroundColor !== 'transparent' &&
          comp.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ) {
          bgHex = rgbStringToHex(comp.backgroundColor, '#1C1A2B');
        } else if (comp.backgroundImage && comp.backgroundImage !== 'none') {
          bgHex = '#2A1B4E';
        }
      } catch {
        // Ignore
      }
    }

    return {
      index: idx + 1,
      layerId: layer.id,
      name: layer.name,
      tag: layer.tag,
      textSnippet: (layer.textValue || '').trim().slice(0, 56),
      rect: { ...layer.currentRect },
      colorHex,
      bgHex,
      sourceFile: layer.sourceFile || 'components/demo/DemoApp.tsx',
      sourceLine: layer.sourceLine,
      selector: layer.selector,
    };
  });

  // Build structured Markdown / text report of all objects inside the screenshot
  const reportLines: string[] = [
    `### Визуально-технический скриншот (${mode === 'full' ? 'Весь экран' : 'Выделенный фрагмент'})`,
    `- **Устройство:** ${deviceName}`,
    `- **Область захвата:** X=${safeCrop.x}, Y=${safeCrop.y}, ${safeCrop.width}×${safeCrop.height}px`,
    `- **Объектов в кадре:** ${objects.length}`,
    '',
    '#### Список объектов в области скриншота:',
    ...objects.map((obj) => {
      const textPart = obj.textSnippet ? ` · Текст: "${obj.textSnippet}"` : '';
      const srcPart = obj.sourceFile
        ? ` · \`${obj.sourceFile}${obj.sourceLine ? `:${obj.sourceLine}` : ''}\``
        : '';
      return `${obj.index}. **[${obj.name}]** \`<${obj.tag}>\` (${obj.rect.width}×${obj.rect.height}px @ ${obj.rect.x},${obj.rect.y}) · Цвет: \`${obj.colorHex}\`${textPart}${srcPart}`;
    }),
  ];
  const markdownReport = reportLines.join('\n');

  let dataUrl = '';
  let visualOnlyDataUrl = '';

  if (typeof document !== 'undefined') {
    const dpr = 2;
    const pad = 16;
    const rowHeight = 20;
    const headerFooterHeight = 76 + Math.max(1, objects.length) * rowHeight + 20;
    const canvasW = Math.max(540, safeCrop.width + pad * 2);
    const canvasH = safeCrop.height + pad * 2 + headerFooterHeight;

    // 1. Render Pure Visual Viewport Canvas first (for interactive overlay in modal)
    const pureCanvas = document.createElement('canvas');
    pureCanvas.width = safeCrop.width * dpr;
    pureCanvas.height = safeCrop.height * dpr;
    const pureCtx = pureCanvas.getContext('2d');
    if (pureCtx) {
      pureCtx.scale(dpr, dpr);
      paintDomVisualToCanvas(pureCtx, doc, safeCrop, 0, 0);
      visualOnlyDataUrl = pureCanvas.toDataURL('image/png');
    }

    // 2. Render Composite Visual + Semi-Transparent Element Grid + Technical Specification Footer PNG
    const canvas = document.createElement('canvas');
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.scale(dpr, dpr);

      // Outer Frame Background
      ctx.fillStyle = '#0C0C0E';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Top Title Strip
      ctx.fillStyle = '#18181C';
      ctx.fillRect(0, 0, canvasW, 34);
      ctx.fillStyle = '#E4E4E7';
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(
        `SNAPSHOT · ${deviceName} · [${safeCrop.x},${safeCrop.y} ${safeCrop.width}×${safeCrop.height}px] · Объектов: ${objects.length}`,
        12,
        21
      );

      // Visual Viewport Area (Cropped to safeCrop)
      const viewX = Math.round((canvasW - safeCrop.width) / 2);
      const viewY = 44;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(viewX, viewY, safeCrop.width, safeCrop.height, 12);
      ctx.clip();

      // Step A: Paint full visual UI of the captured screen slice
      paintDomVisualToCanvas(ctx, doc, safeCrop, viewX, viewY);

      // Step B: Paint semi-transparent technical element grid OVER the visual UI
      paintSemiTransparentGridOverlay(ctx, objects, safeCrop, viewX, viewY);

      ctx.restore();

      // Frame Border around Visual Snapshot
      ctx.strokeStyle = '#27272A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(viewX, viewY, safeCrop.width, safeCrop.height, 12);
      ctx.stroke();

      // Step C: Technical Specification Manifest Footer (Printed directly on the screenshot PNG)
      const specStartY = viewY + safeCrop.height + 16;
      ctx.fillStyle = '#141417';
      ctx.fillRect(12, specStartY, canvasW - 24, canvasH - specStartY - 10);
      ctx.strokeStyle = '#26262B';
      ctx.strokeRect(12, specStartY, canvasW - 24, canvasH - specStartY - 10);

      ctx.fillStyle = '#A1A1AA';
      ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(
        `ОБЪЕКТЫ В ОБЛАСТИ СКРИНШОТА (${objects.length}):`,
        22,
        specStartY + 18
      );

      objects.forEach((obj, i) => {
        const y = specStartY + 36 + i * rowHeight;
        ctx.fillStyle = obj.colorHex;
        ctx.beginPath();
        ctx.arc(26, y - 3.5, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#F4F4F5';
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
        const txtDesc = obj.textSnippet ? ` · "${obj.textSnippet.slice(0, 24)}"` : '';
        const lineText = `#${obj.index} ${obj.name} <${obj.tag}> · ${obj.rect.width}×${obj.rect.height}px (${obj.rect.x},${obj.rect.y})${txtDesc}`;
        ctx.fillText(lineText.slice(0, 72), 36, y);
      });

      dataUrl = canvas.toDataURL('image/png');
    }
  }

  return {
    id: `shot-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString('ru-RU'),
    deviceName,
    mode,
    cropRect: safeCrop,
    dataUrl,
    visualOnlyDataUrl,
    objects,
    markdownReport,
  };
}
