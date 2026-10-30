import { TouchDrawing } from './board-input';

export interface AppSettings {
  touchDrawing: TouchDrawing;
  /** Un stylet a déjà été utilisé sur cet appareil. */
  penDetected: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { touchDrawing: 'auto', penDetected: false };

export const TOUCH_DRAWING_VALUES: readonly TouchDrawing[] = ['auto', 'draw', 'pan'];

/** Réglages lus du stockage local : toute valeur invalide retombe sur la valeur par défaut. */
export function parseSettings(raw: string | null | undefined): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      touchDrawing: TOUCH_DRAWING_VALUES.includes(data['touchDrawing'] as TouchDrawing)
        ? (data['touchDrawing'] as TouchDrawing)
        : DEFAULT_SETTINGS.touchDrawing,
      penDetected: data['penDetected'] === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
