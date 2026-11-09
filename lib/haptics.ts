export type ImpactStyle =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'rigid'
  | 'soft'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error';

export interface HapticEventRecord {
  id: string;
  style: ImpactStyle;
  timestamp: string;
  frequencyHz: number;
  durationMs: number;
  source: string;
}

/**
 * Singleton AudioContext manager for Web Haptics.
 * Eliminates the browser max-AudioContext leak from the original implementation.
 */
class HapticAudioEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getProfile(style: ImpactStyle): { frequencyHz: number; durationMs: number; gain: number } {
    switch (style) {
      case 'selection':
        return { frequencyHz: 1250, durationMs: 18, gain: 0.06 };
      case 'light':
      case 'soft':
        return { frequencyHz: 880, durationMs: 22, gain: 0.07 };
      case 'medium':
        return { frequencyHz: 640, durationMs: 28, gain: 0.09 };
      case 'heavy':
      case 'rigid':
        return { frequencyHz: 420, durationMs: 38, gain: 0.12 };
      case 'success':
        return { frequencyHz: 980, durationMs: 42, gain: 0.09 };
      case 'warning':
        return { frequencyHz: 520, durationMs: 45, gain: 0.1 };
      case 'error':
        return { frequencyHz: 310, durationMs: 55, gain: 0.12 };
      default:
        return { frequencyHz: 800, durationMs: 25, gain: 0.08 };
    }
  }

  public play(style: ImpactStyle): { frequencyHz: number; durationMs: number } {
    const profile = this.getProfile(style);
    try {
      const ctx = this.getContext();
      if (!ctx) return profile;

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = style === 'error' || style === 'warning' ? 'triangle' : 'sine';
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      const durationSec = profile.durationMs / 1000;
      osc.frequency.setValueAtTime(profile.frequencyHz, ctx.currentTime);
      gainNode.gain.setValueAtTime(profile.gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

      osc.start();
      osc.stop(ctx.currentTime + durationSec);
    } catch {
      // Ignore if autoplay policy blocks audio before first gesture
    }
    return profile;
  }
}

export const hapticAudioEngine = new HapticAudioEngine();

export function triggerHaptic(style: ImpactStyle = 'light', source = 'MiniApp'): void {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'tg:haptic',
          detail: { type: style, source, ts: Date.now() },
        },
        '*'
      );
    }

    const tg =
      typeof window !== 'undefined'
        ? (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: Record<string, (arg?: string) => void> } } })
            .Telegram?.WebApp?.HapticFeedback
        : undefined;

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
  } catch {
    // No-op fallback
  }
}
