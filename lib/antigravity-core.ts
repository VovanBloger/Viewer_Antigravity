export interface StyleTunerState {
  bgOpacity: number;
  widthVal: number;
  widthUnit: 'px' | '%' | 'vw' | 'auto';
  heightVal: number;
  heightUnit: 'px' | '%' | 'dvh' | 'auto';
  radiusVal: number;
  align: 'left' | 'center' | 'right' | 'none';
  paddingX: number;
  paddingY: number;
}

export const DEFAULT_TUNER_STATE: StyleTunerState = {
  bgOpacity: 100,
  widthVal: 0,
  widthUnit: 'auto',
  heightVal: 0,
  heightUnit: 'auto',
  radiusVal: 0,
  align: 'none',
  paddingX: 0,
  paddingY: 0,
};

export interface BoxModelMetrics {
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

export interface LayerSummary {
  tag: string;
  className: string;
  textSnippet: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  width: number;
  height: number;
  roleHint: 'Верхний' | 'Под ним' | 'Дно';
}

export interface ElementInfo {
  tag: string;
  id?: string;
  className: string;
  textSnippet: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  boxModel?: BoxModelMetrics;
  selector: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  layerIndex?: number;
  totalLayers?: number;
  coveringTag?: string;
}

export interface StyleDiffItem {
  property: string;
  before: string;
  after: string;
  tailwindSuggestion: string;
}

export interface AgentDirectivePreset {
  id: string;
  label: string;
  shortTag: string;
  instruction: string;
}

export const SMART_AGENT_DIRECTIVES: AgentDirectivePreset[] = [
  {
    id: 'responsive-320',
    label: 'Адаптировать под 320px',
    shortTag: 'Responsive 320px',
    instruction:
      'Обеспечь корректное отображение элемента на узких экранах (320px–375px): предотврати переполнение по горизонтали, добавь min-w-0 и адаптивные отступы.',
  },
  {
    id: 'fix-zindex',
    label: 'Исправить перекрытие Z-Index',
    shortTag: 'Z-Index & Hitbox',
    instruction:
      'Исправь конфликт наложения слоёв: убедись, что интерактивный элемент не перекрывается декоративными контейнерами (pointer-events-none на подложках и корректный z-index).',
  },
  {
    id: 'safe-area',
    label: 'Защита Telegram Safe Area',
    shortTag: 'Safe Area Insets',
    instruction:
      'Учти системные отступы Telegram Mini App (верхний хедер и нижний Home Indicator): добавь безопасный отступ pb-safe / pt-safe, чтобы контент не перекрывался.',
  },
  {
    id: 'extract-component',
    label: 'Вынести в отдельный компонент',
    shortTag: 'Extract Component',
    instruction:
      'Декомпозируй этот DOM-узел в переиспользуемый типизированный React-компонент в папке components/ с чистыми пропсами.',
  },
  {
    id: 'wcag-contrast',
    label: 'Улучшить контрастность и тач-зону',
    shortTag: 'WCAG & Touch >= 40px',
    instruction:
      'Доведи контрастность текста до стандарта WCAG AA (минимум 4.5:1) и увеличь область нажатия минимум до 40×40px.',
  },
];

export interface AgentQueueItem {
  id: string;
  pinNumber: number;
  createdAt: string;
  slotDeviceName: string;
  element: ElementInfo;
  diffs: StyleDiffItem[];
  directiveId?: string;
  note: string;
  priority: 'high' | 'normal' | 'low';
}

export interface AuditNodeInput {
  tag: string;
  selector: string;
  textSnippet: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  rect: { top: number; left: number; width: number; height: number; right: number; bottom: number };
  scrollWidth: number;
  clientWidth: number;
  isInteractive: boolean;
}

export interface LayoutAuditIssue {
  id: string;
  severity: 'error' | 'warning';
  category: 'overflow-x' | 'touch-target' | 'safe-area';
  title: string;
  description: string;
  selector: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  suggestedFix: string;
  rect: { top: number; left: number; width: number; height: number };
}

/**
 * Pure function that computes concrete CSS & Tailwind diffs between initial and tuned state.
 */
export function computeStyleDiff(
  initial: StyleTunerState,
  current: StyleTunerState,
  initialClasses: string,
  currentClasses: string
): StyleDiffItem[] {
  const diffs: StyleDiffItem[] = [];

  if (initial.bgOpacity !== current.bgOpacity) {
    const tailwindSuggestion =
      current.bgOpacity === 0
        ? 'bg-transparent'
        : `bg-opacity-[${(current.bgOpacity / 100).toFixed(2)}]`;
    diffs.push({
      property: 'Прозрачность фона',
      before: `${initial.bgOpacity}%`,
      after: `${current.bgOpacity}%`,
      tailwindSuggestion,
    });
  }

  if (initial.align !== current.align && current.align !== 'none') {
    const mapAlign = {
      left: 'text-left self-start',
      center: 'text-center self-center mx-auto',
      right: 'text-right self-end',
      none: '',
    };
    diffs.push({
      property: 'Выравнивание',
      before: initial.align === 'none' ? 'по умолчанию' : initial.align,
      after: current.align,
      tailwindSuggestion: mapAlign[current.align],
    });
  }

  if (
    current.widthUnit !== 'auto' &&
    (initial.widthVal !== current.widthVal || initial.widthUnit !== current.widthUnit) &&
    current.widthVal > 0
  ) {
    diffs.push({
      property: 'Ширина',
      before: initial.widthUnit === 'auto' ? `auto (${initial.widthVal}px)` : `${initial.widthVal}${initial.widthUnit}`,
      after: `${current.widthVal}${current.widthUnit}`,
      tailwindSuggestion: `w-[${current.widthVal}${current.widthUnit}]`,
    });
  }

  if (
    current.heightUnit !== 'auto' &&
    (initial.heightVal !== current.heightVal || initial.heightUnit !== current.heightUnit) &&
    current.heightVal > 0
  ) {
    diffs.push({
      property: 'Высота',
      before:
        initial.heightUnit === 'auto' ? `auto (${initial.heightVal}px)` : `${initial.heightVal}${initial.heightUnit}`,
      after: `${current.heightVal}${current.heightUnit}`,
      tailwindSuggestion: `h-[${current.heightVal}${current.heightUnit}]`,
    });
  }

  if (initial.radiusVal !== current.radiusVal) {
    diffs.push({
      property: 'Скругление углов',
      before: `${initial.radiusVal}px`,
      after: `${current.radiusVal}px`,
      tailwindSuggestion: current.radiusVal === 0 ? 'rounded-none' : `rounded-[${current.radiusVal}px]`,
    });
  }

  if (initial.paddingX !== current.paddingX && current.paddingX > 0) {
    diffs.push({
      property: 'Горизонтальный padding',
      before: `${initial.paddingX}px`,
      after: `${current.paddingX}px`,
      tailwindSuggestion: `px-[${current.paddingX}px]`,
    });
  }

  if (initial.paddingY !== current.paddingY && current.paddingY > 0) {
    diffs.push({
      property: 'Вертикальный padding',
      before: `${initial.paddingY}px`,
      after: `${current.paddingY}px`,
      tailwindSuggestion: `py-[${current.paddingY}px]`,
    });
  }

  const normInit = initialClasses.trim().replace(/\s+/g, ' ');
  const normCurr = currentClasses.trim().replace(/\s+/g, ' ');
  if (normInit !== normCurr) {
    diffs.push({
      property: 'Классы Tailwind',
      before: normInit || '(пусто)',
      after: normCurr || '(пусто)',
      tailwindSuggestion: normCurr,
    });
  }

  return diffs;
}

/**
 * Generates an IDE deep link URL (antigravity://, vscode://, cursor://) for opening a file at a specific line.
 */
export function buildIdeDeepLink(
  sourceFile?: string,
  sourceLine?: number,
  scheme: 'antigravity' | 'vscode' | 'cursor' = 'vscode'
): string {
  if (!sourceFile) return '';
  const cleanPath = sourceFile.replace(/^\/+/, '');
  const lineSuffix = sourceLine && sourceLine > 0 ? `:${sourceLine}:1` : '';
  return `${scheme}://file/${cleanPath}${lineSuffix}`;
}

/**
 * Builds a structured multi-element Markdown prompt for the Antigravity AI Agent.
 */
export function buildConsolidatedAgentPrompt(
  queue: AgentQueueItem[],
  workspaceMeta?: { url: string; theme: string; activeDevices: string[] }
): string {
  if (queue.length === 0) {
    return 'Очередь задач для агента Antigravity пуста. Выберите элемент в режиме инспектора (Alt+I) и добавьте его в пакет правок.';
  }

  const headerLines = [
    `# ЗАДАНИЕ ДЛЯ АГЕНТА ANTIGRAVITY (${queue.length} ${queue.length === 1 ? 'элемент' : 'элементов'})`,
  ];

  if (workspaceMeta) {
    headerLines.push(
      `Контекст стенда: маршрут \`${workspaceMeta.url}\` · тема \`${workspaceMeta.theme}\` · экраны: ${workspaceMeta.activeDevices.join(', ')}`
    );
  }
  headerLines.push('');

  const sections = queue.map((item) => {
    const el = item.element;
    const directive = SMART_AGENT_DIRECTIVES.find((d) => d.id === item.directiveId);
    const lines: string[] = [];

    lines.push(`## [Пин #${item.pinNumber}] <${el.tag}> ${el.componentName ? `в компоненте \`${el.componentName}\`` : ''}`);
    lines.push(`- Приоритет: ${item.priority === 'high' ? 'Высокий' : item.priority === 'normal' ? 'Обычный' : 'Низкий'}`);
    lines.push(`- Экран обнаружения: ${item.slotDeviceName}`);
    if (el.sourceFile) {
      lines.push(`- Файл и строка: \`${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ''}\``);
    }
    if (el.layerIndex !== undefined && el.totalLayers && el.totalLayers > 1) {
      lines.push(
        `- Слой Z-Index: ${el.layerIndex + 1} из ${el.totalLayers}${
          el.coveringTag ? ` (перекрыт сверху тегом <${el.coveringTag}>)` : ' (верхний слой)'
        }`
      );
    }
    lines.push(`- DOM-путь: \`${el.selector}\``);
    lines.push(`- Геометрия: ${el.rect.width} × ${el.rect.height} px (top: ${el.rect.top}px, left: ${el.rect.left}px)`);
    if (el.className) {
      lines.push(`- Текущие классы: \`${el.className}\``);
    }
    if (el.textSnippet) {
      lines.push(`- Текст внутри: "${el.textSnippet}"`);
    }

    if (item.diffs.length > 0) {
      lines.push(`- Подобранные изменения стилей (Было → Стало):`);
      item.diffs.forEach((d) => {
        lines.push(`  • ${d.property}: \`${d.before}\` → \`${d.after}\` (Tailwind: \`${d.tailwindSuggestion}\`)`);
      });
    }

    if (directive) {
      lines.push(`- Архитектурная директива (${directive.label}): ${directive.instruction}`);
    }

    lines.push(
      `- Что нужно сделать: ${item.note.trim() ? item.note.trim() : 'Примени указанные изменения стилей и проверь адаптивность.'}`
    );

    return lines.join('\n');
  });

  return [...headerLines, ...sections.join('\n\n---\n\n').split('\n')].join('\n');
}

/**
 * Pure layout auditor that detects horizontal overflow, undersized touch targets (<40px),
 * and collisions with Telegram Safe Area insets.
 */
export function analyzeElementAuditIssues(
  nodes: AuditNodeInput[],
  viewportWidth: number,
  safeAreaTop: number,
  safeAreaBottom: number,
  viewportHeight: number
): LayoutAuditIssue[] {
  const issues: LayoutAuditIssue[] = [];

  nodes.forEach((node, idx) => {
    // 1. Horizontal overflow check
    if (node.rect.right > viewportWidth + 2 || node.scrollWidth > node.clientWidth + 4) {
      issues.push({
        id: `issue-overflow-${idx}`,
        severity: 'error',
        category: 'overflow-x',
        title: `Горизонтальное переполнение (<${node.tag}>)`,
        description: `Элемент выходит за правую границу экрана (${Math.round(node.rect.right)}px > ${viewportWidth}px) или вызывает горизонтальный скролл (${node.scrollWidth}px > ${node.clientWidth}px).`,
        selector: node.selector,
        componentName: node.componentName,
        sourceFile: node.sourceFile,
        sourceLine: node.sourceLine,
        suggestedFix: 'Добавь min-w-0, max-w-full, overflow-hidden или flex-wrap на родительский контейнер.',
        rect: {
          top: Math.round(node.rect.top),
          left: Math.round(node.rect.left),
          width: Math.round(node.rect.width),
          height: Math.round(node.rect.height),
        },
      });
    }

    // 2. Touch target size check (< 40x40px for interactive buttons/links)
    if (
      node.isInteractive &&
      node.rect.width > 0 &&
      node.rect.height > 0 &&
      (node.rect.width < 36 || node.rect.height < 36)
    ) {
      issues.push({
        id: `issue-touch-${idx}`,
        severity: 'warning',
        category: 'touch-target',
        title: `Маленькая тач-зона кнопки (${Math.round(node.rect.width)}×${Math.round(node.rect.height)}px)`,
        description: `Интерактивный элемент <${node.tag}> меньше рекомендуемого минимума 40×40px для мобильных экранов.`,
        selector: node.selector,
        componentName: node.componentName,
        sourceFile: node.sourceFile,
        sourceLine: node.sourceLine,
        suggestedFix: 'Увеличь область касания до min-w-[40px] min-h-[40px] или добавь внутренние отступы p-2.5.',
        rect: {
          top: Math.round(node.rect.top),
          left: Math.round(node.rect.left),
          width: Math.round(node.rect.width),
          height: Math.round(node.rect.height),
        },
      });
    }

    // 3. Telegram Safe Area Top collision for interactive elements
    if (node.isInteractive && node.rect.top >= 0 && node.rect.top < safeAreaTop - 4) {
      issues.push({
        id: `issue-safetop-${idx}`,
        severity: 'warning',
        category: 'safe-area',
        title: `Конфликт с верхней Safe Area Telegram (<${node.tag}>)`,
        description: `Интерактивный элемент расположен на высоте ${Math.round(node.rect.top)}px и перекрывается системным баром Telegram (${safeAreaTop}px).`,
        selector: node.selector,
        componentName: node.componentName,
        sourceFile: node.sourceFile,
        sourceLine: node.sourceLine,
        suggestedFix: `Добавь верхний безопасный отступ pt-[${safeAreaTop}px] для шапки экрана.`,
        rect: {
          top: Math.round(node.rect.top),
          left: Math.round(node.rect.left),
          width: Math.round(node.rect.width),
          height: Math.round(node.rect.height),
        },
      });
    }

    // 4. Telegram Safe Area Bottom collision
    if (
      node.isInteractive &&
      safeAreaBottom > 0 &&
      node.rect.bottom > viewportHeight - safeAreaBottom + 6 &&
      node.rect.bottom <= viewportHeight + 4
    ) {
      issues.push({
        id: `issue-safebottom-${idx}`,
        severity: 'warning',
        category: 'safe-area',
        title: `Конфликт с нижней зоной Home Indicator (<${node.tag}>)`,
        description: `Нижняя граница кнопки (${Math.round(node.rect.bottom)}px) попадает в зону жеста закрытия (${viewportHeight - safeAreaBottom}px–${viewportHeight}px).`,
        selector: node.selector,
        componentName: node.componentName,
        sourceFile: node.sourceFile,
        sourceLine: node.sourceLine,
        suggestedFix: 'Добавь нижний отступ pb-6 или учти env(safe-area-inset-bottom) у нижней навигации.',
        rect: {
          top: Math.round(node.rect.top),
          left: Math.round(node.rect.left),
          width: Math.round(node.rect.width),
          height: Math.round(node.rect.height),
        },
      });
    }
  });

  return issues.slice(0, 25);
}

/**
 * Calculates optimal canvas zoom factor (0.25 to 1.25) so all active device slots fit cleanly.
 */
export function calculateFitZoom(
  slots: Array<{ w: number; h: number; rotated: boolean; showBezel: boolean }>,
  canvasWidth: number,
  canvasHeight: number
): number {
  if (slots.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return 1;
  const bezelPad = 28;
  const gap = 32;

  let totalWidth = 0;
  let maxHeight = 0;

  slots.forEach((s, i) => {
    const baseW = s.rotated ? s.h : s.w;
    const baseH = s.rotated ? s.w : s.h;
    const slotW = s.showBezel ? baseW + bezelPad : baseW;
    const slotH = (s.showBezel ? baseH + bezelPad : baseH) + 54; // +54px for slot header row
    totalWidth += slotW + (i > 0 ? gap : 0);
    if (slotH > maxHeight) maxHeight = slotH;
  });

  const ratioX = (canvasWidth - 48) / Math.max(1, totalWidth);
  const ratioY = (canvasHeight - 32) / Math.max(1, maxHeight);
  const rawZoom = Math.min(ratioX, ratioY, 1.15);
  return Math.max(0.25, Math.min(1.25, Math.round(rawZoom * 100) / 100));
}
