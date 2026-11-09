import {
  BoxModelMetrics,
  AuditNodeInput,
  LayoutAuditIssue,
  analyzeElementAuditIssues,
} from './antigravity-core';
import { DeviceSpec } from './preview-devices';

/**
 * Extracts component name, source file path, and line number from DOM data attributes
 * or React 18/19 internal Fiber nodes (__reactFiber$ / __reactInternalInstance$).
 */
export function getReactSourceInfo(target: HTMLElement | null): {
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
} {
  try {
    if (!target) return {};

    // 1. Check explicit deterministic attributes on element or closest annotated ancestor
    const annotatedEl = target.closest('[data-component], [data-source-file]') as HTMLElement | null;
    const dataComponent = target.getAttribute('data-component') || annotatedEl?.getAttribute('data-component') || undefined;
    const dataFile = target.getAttribute('data-source-file') || annotatedEl?.getAttribute('data-source-file') || undefined;
    const dataLineRaw = target.getAttribute('data-source-line') || annotatedEl?.getAttribute('data-source-line');
    const dataLine = dataLineRaw ? parseInt(dataLineRaw, 10) : undefined;

    if (dataComponent && dataFile) {
      return {
        componentName: dataComponent,
        sourceFile: dataFile,
        sourceLine: dataLine,
      };
    }

    // 2. Fallback: Walk React Fiber tree
    const recordTarget = target as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(recordTarget).find(
      (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) {
      return { componentName: dataComponent, sourceFile: dataFile, sourceLine: dataLine };
    }

    let curr: any = recordTarget[fiberKey];
    let sourceFile = dataFile;
    let sourceLine = dataLine;
    let componentName = dataComponent;
    let depth = 0;

    while (curr && depth < 20) {
      const src =
        curr._debugSource ||
        curr._source ||
        curr.memoizedProps?.__source ||
        curr._debugOwner?._debugSource;
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

export function getBoxModelMetrics(target: HTMLElement, win: Window): BoxModelMetrics {
  try {
    const comp = win.getComputedStyle(target);
    return {
      marginTop: Math.round(parseFloat(comp.marginTop || '0') || 0),
      marginRight: Math.round(parseFloat(comp.marginRight || '0') || 0),
      marginBottom: Math.round(parseFloat(comp.marginBottom || '0') || 0),
      marginLeft: Math.round(parseFloat(comp.marginLeft || '0') || 0),
      paddingTop: Math.round(parseFloat(comp.paddingTop || '0') || 0),
      paddingRight: Math.round(parseFloat(comp.paddingRight || '0') || 0),
      paddingBottom: Math.round(parseFloat(comp.paddingBottom || '0') || 0),
      paddingLeft: Math.round(parseFloat(comp.paddingLeft || '0') || 0),
    };
  } catch {
    return {
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    };
  }
}

export function buildDomSelectorPath(target: HTMLElement): string {
  const path: string[] = [];
  let curr: HTMLElement | null = target;
  while (curr && curr.tagName !== 'BODY' && curr.tagName !== 'HTML' && path.length < 5) {
    let part = curr.tagName.toLowerCase();
    if (curr.id) {
      part += `#${curr.id}`;
    } else if (curr.className && typeof curr.className === 'string') {
      const cls = curr.className
        .split(' ')
        .filter((c) => c && !c.startsWith('hover:') && !c.startsWith('focus:'))[0];
      if (cls) part += `.${cls}`;
    }
    path.unshift(part);
    curr = curr.parentElement;
  }
  return path.join(' > ');
}

export function updateSelectedOverlay(
  target: HTMLElement,
  doc: Document,
  showBoxModel = false
): void {
  try {
    let selOverlay = doc.getElementById('__antigravity_selected_overlay__');
    if (!selOverlay) {
      selOverlay = doc.createElement('div');
      selOverlay.id = '__antigravity_selected_overlay__';
      selOverlay.style.position = 'fixed';
      selOverlay.style.pointerEvents = 'none';
      selOverlay.style.zIndex = '999998';
      selOverlay.style.border = '2px solid #10B981';
      selOverlay.style.background = 'rgba(16, 185, 129, 0.14)';
      selOverlay.style.borderRadius = '6px';
      selOverlay.style.transition = 'top 60ms ease-out, left 60ms ease-out, width 60ms ease-out, height 60ms ease-out';
      selOverlay.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.4), 0 0 14px rgba(16, 185, 129, 0.4)';

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
    const win = doc.defaultView || window;
    const bm = getBoxModelMetrics(target, win);

    selOverlay.style.display = 'block';
    selOverlay.style.top = `${r.top}px`;
    selOverlay.style.left = `${r.left}px`;
    selOverlay.style.width = `${r.width}px`;
    selOverlay.style.height = `${r.height}px`;

    if (showBoxModel) {
      selOverlay.style.outline = `${Math.max(1, bm.marginTop)}px dashed rgba(245, 158, 11, 0.65)`;
    } else {
      selOverlay.style.outline = 'none';
    }

    const badge = doc.getElementById('__antigravity_selected_badge__');
    if (badge) {
      const { componentName } = getReactSourceInfo(target);
      const compLabel = componentName ? ` · ${componentName}` : '';
      const padLabel =
        showBoxModel && (bm.paddingLeft > 0 || bm.paddingTop > 0)
          ? ` · pad:${bm.paddingTop}/${bm.paddingLeft}`
          : '';
      badge.textContent = `<${target.tagName.toLowerCase()}> ${Math.round(r.width)}×${Math.round(r.height)}px${compLabel}${padLabel}`;
    }
  } catch {
    // Ignore cross-frame error
  }
}

export function clearSelectedOverlay(doc?: Document | null): void {
  try {
    if (!doc) return;
    const el = doc.getElementById('__antigravity_selected_overlay__');
    if (el) el.remove();
  } catch {
    // Ignore
  }
}

export function scanIframeForAuditIssues(
  doc: Document,
  device: DeviceSpec,
  rotated: boolean
): LayoutAuditIssue[] {
  const viewportW = rotated ? device.h : device.w;
  const viewportH = rotated ? device.w : device.h;

  const elements = Array.from(doc.body.querySelectorAll('*')) as HTMLElement[];
  const nodes: AuditNodeInput[] = [];

  for (const el of elements) {
    if (!el || el.id?.startsWith('__antigravity')) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const isInteractive =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      tag === 'select' ||
      el.getAttribute('role') === 'button';

    const { componentName, sourceFile, sourceLine } = getReactSourceInfo(el);

    nodes.push({
      tag,
      selector: buildDomSelectorPath(el),
      textSnippet: (el.innerText || '').trim().slice(0, 50),
      componentName,
      sourceFile,
      sourceLine,
      rect: {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      },
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      isInteractive,
    });
  }

  return analyzeElementAuditIssues(nodes, viewportW, device.safeTop, device.safeBottom, viewportH);
}
