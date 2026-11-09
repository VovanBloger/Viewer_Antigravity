export interface DeviceSpec {
  key: string;
  name: string;
  w: number;
  h: number;
  rad: string;
  dynamicIsland: boolean;
  safeTop: number;
  safeBottom: number;
  platform: 'ios' | 'android' | 'tablet';
  dpr: number;
}

export const PREVIEW_DEVICES: Record<string, DeviceSpec> = {
  iphone16pro: {
    key: 'iphone16pro',
    name: 'iPhone 16 Pro',
    w: 393,
    h: 852,
    rad: '52px',
    dynamicIsland: true,
    safeTop: 59,
    safeBottom: 34,
    platform: 'ios',
    dpr: 3,
  },
  iphone16promax: {
    key: 'iphone16promax',
    name: 'iPhone 16 Pro Max',
    w: 440,
    h: 956,
    rad: '55px',
    dynamicIsland: true,
    safeTop: 59,
    safeBottom: 34,
    platform: 'ios',
    dpr: 3,
  },
  iphone15: {
    key: 'iphone15',
    name: 'iPhone 15 / 14',
    w: 390,
    h: 844,
    rad: '48px',
    dynamicIsland: true,
    safeTop: 47,
    safeBottom: 34,
    platform: 'ios',
    dpr: 3,
  },
  iphonese: {
    key: 'iphonese',
    name: 'iPhone SE (3rd Gen)',
    w: 375,
    h: 667,
    rad: '36px',
    dynamicIsland: false,
    safeTop: 20,
    safeBottom: 0,
    platform: 'ios',
    dpr: 2,
  },
  s24ultra: {
    key: 's24ultra',
    name: 'Galaxy S24 Ultra',
    w: 412,
    h: 915,
    rad: '28px',
    dynamicIsland: false,
    safeTop: 38,
    safeBottom: 24,
    platform: 'android',
    dpr: 3.5,
  },
  pixel9pro: {
    key: 'pixel9pro',
    name: 'Google Pixel 9 Pro',
    w: 412,
    h: 892,
    rad: '44px',
    dynamicIsland: false,
    safeTop: 42,
    safeBottom: 24,
    platform: 'android',
    dpr: 3,
  },
  compact320: {
    key: 'compact320',
    name: 'Compact 320px Stress',
    w: 320,
    h: 568,
    rad: '30px',
    dynamicIsland: false,
    safeTop: 20,
    safeBottom: 0,
    platform: 'ios',
    dpr: 2,
  },
  ipadmini: {
    key: 'ipadmini',
    name: 'iPad Mini 6',
    w: 744,
    h: 1133,
    rad: '38px',
    dynamicIsland: false,
    safeTop: 24,
    safeBottom: 20,
    platform: 'tablet',
    dpr: 2,
  },
};

export interface WorkspacePreset {
  id: string;
  name: string;
  description: string;
  slots: Array<{ deviceKey: string; rotated: boolean }>;
  recommendedZoom: number;
}

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: 'single-flagship',
    name: 'Флагман iOS',
    description: 'Один экран iPhone 16 Pro в масштабе 100%',
    slots: [{ deviceKey: 'iphone16pro', rotated: false }],
    recommendedZoom: 0.85,
  },
  {
    id: 'ios-vs-android',
    name: 'iOS vs Android',
    description: 'Параллельное сравнение iPhone 16 Pro и Galaxy S24 Ultra',
    slots: [
      { deviceKey: 'iphone16pro', rotated: false },
      { deviceKey: 's24ultra', rotated: false },
    ],
    recommendedZoom: 0.78,
  },
  {
    id: 'small-screen-stress',
    name: 'Стресс-тест узких экранов',
    description: 'Проверка вёрстки на Compact 320px, iPhone SE и iPhone 16 Pro',
    slots: [
      { deviceKey: 'compact320', rotated: false },
      { deviceKey: 'iphonese', rotated: false },
      { deviceKey: 'iphone16pro', rotated: false },
    ],
    recommendedZoom: 0.72,
  },
  {
    id: 'portrait-vs-landscape',
    name: 'Портрет + Альбом',
    description: 'Один девайс в двух ориентациях одновременно',
    slots: [
      { deviceKey: 'iphone16pro', rotated: false },
      { deviceKey: 'iphone16pro', rotated: true },
    ],
    recommendedZoom: 0.72,
  },
];

export interface AntigravityTheme {
  key: 'obsidian' | 'daylight';
  name: string;
  subtitle: string;
  isDark: boolean;
  canvasBg: string;
  surfaceBg: string;
  panelBg: string;
  borderClass: string;
  textPrimary: string;
  textMuted: string;
  accentHex: string;
}

export const ANTIGRAVITY_THEMES: Record<AntigravityTheme['key'], AntigravityTheme> = {
  obsidian: {
    key: 'obsidian',
    name: 'Linear Graphite',
    subtitle: 'Строгий монохромный серый профиль в стиле Linear и Figma',
    isDark: true,
    canvasBg: 'bg-[#0C0C0E]',
    surfaceBg: 'bg-[#141417]',
    panelBg: 'bg-[#1A1A1E]',
    borderClass: 'border-[#26262B]',
    textPrimary: 'text-zinc-100',
    textMuted: 'text-zinc-400',
    accentHex: '#E4E4E7',
  },
  daylight: {
    key: 'daylight',
    name: 'Clean Daylight',
    subtitle: 'Светлая студийная тема для проверки дневного контраста',
    isDark: false,
    canvasBg: 'bg-slate-100',
    surfaceBg: 'bg-white',
    panelBg: 'bg-slate-50',
    borderClass: 'border-slate-200',
    textPrimary: 'text-slate-900',
    textMuted: 'text-slate-500',
    accentHex: '#9333EA',
  },
};

export interface HotkeyBinding {
  id: string;
  actionName: string;
  category: 'inspector' | 'workspace' | 'agent';
  combo: string;
  description: string;
}

export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  {
    id: 'toggle-inspect',
    actionName: 'Режим инспектора DOM',
    category: 'inspector',
    combo: 'Alt+I',
    description: 'Включить/выключить прицел выбора элементов и слоёв Z-Index',
  },
  {
    id: 'command-palette',
    actionName: 'Командная палитра',
    category: 'workspace',
    combo: 'Ctrl+K',
    description: 'Быстрый поиск команд, пресетов устройств и действий агента',
  },
  {
    id: 'enqueue-element',
    actionName: 'Добавить узел в очередь агента',
    category: 'agent',
    combo: 'Alt+Q',
    description: 'Сохранить выбранный элемент и дифф стилей в пакет правок Antigravity',
  },
  {
    id: 'copy-batch-prompt',
    actionName: 'Скопировать сводный промпт',
    category: 'agent',
    combo: 'Alt+C',
    description: 'Скопировать готовое техническое задание по всей очереди в буфер обмена',
  },
  {
    id: 'toggle-box-model',
    actionName: 'Линейка Box Model и Safe Area',
    category: 'inspector',
    combo: 'Alt+B',
    description: 'Показать/скрыть отступы margin/padding и системные зоны Telegram',
  },
  {
    id: 'fit-zoom',
    actionName: 'Автомасштаб по высоте (Fit)',
    category: 'workspace',
    combo: 'Alt+0',
    description: 'Автоматически вписать все открытые экраны в текущий размер окна',
  },
];
