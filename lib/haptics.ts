export type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection' | 'error' | 'success' | 'warning';

export function triggerHaptic(style: HapticStyle = 'light') {
  if (typeof window === 'undefined') return;

  try {
    // 1. Telegram WebApp HapticFeedback (if inside Telegram)
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (tg) {
      if (style === 'selection') {
        tg.selectionChanged?.();
        return;
      }
      if (style === 'success' || style === 'warning' || style === 'error') {
        tg.notificationOccurred?.(style);
        return;
      }
      tg.impactOccurred?.(style);
      return;
    }

    // 2. Standard Web Navigator Vibration API
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      switch (style) {
        case 'light':
        case 'selection':
          navigator.vibrate(8);
          break;
        case 'medium':
          navigator.vibrate(18);
          break;
        case 'heavy':
        case 'warning':
          navigator.vibrate([25, 20, 25]);
          break;
        case 'error':
          navigator.vibrate([40, 30, 40]);
          break;
        case 'success':
          navigator.vibrate([15, 30, 20]);
          break;
      }
    }
  } catch {}
}
