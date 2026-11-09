export type DeviceCategory = 'ios' | 'android' | 'tablet';

export interface DeviceSpec {
  key: string;
  name: string;
  cat: DeviceCategory;
  w: number;
  h: number;
  rad: string;
  notch?: boolean;
  dynamicIsland?: boolean;
}

export const PREVIEW_DEVICES: Record<string, DeviceSpec> = {
  iphone16pro: {
    key: 'iphone16pro',
    name: 'iPhone 16 Pro',
    cat: 'ios',
    w: 393,
    h: 852,
    rad: '54px',
    dynamicIsland: true,
  },
  iphone17promax: {
    key: 'iphone17promax',
    name: 'iPhone 17 Pro Max',
    cat: 'ios',
    w: 421,
    h: 914,
    rad: '56px',
    dynamicIsland: true,
  },
  iphonese: {
    key: 'iphonese',
    name: 'iPhone SE',
    cat: 'ios',
    w: 375,
    h: 667,
    rad: '36px',
  },
  pixel8: {
    key: 'pixel8',
    name: 'Google Pixel 8',
    cat: 'android',
    w: 412,
    h: 892,
    rad: '48px',
  },
  s24ultra: {
    key: 's24ultra',
    name: 'Galaxy S24 Ultra',
    cat: 'android',
    w: 412,
    h: 899,
    rad: '28px',
  },
  ipadmini: {
    key: 'ipadmini',
    name: 'iPad Mini',
    cat: 'tablet',
    w: 768,
    h: 1024,
    rad: '36px',
  },
};

export const CANVAS_BACKGROUNDS = [
  { key: 'cyber', label: 'Тёмная тема', bg: 'bg-[#090810]', text: 'text-zinc-100', isDark: true },
  { key: 'white', label: 'Светлая тема', bg: 'bg-[#F4F4F8]', text: 'text-zinc-900', isDark: false },
];
