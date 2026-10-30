import { Injectable, computed, signal } from '@angular/core';
import { TouchDrawing } from '../utils/board-input';
import { AppSettings, parseSettings } from '../utils/settings';

/** Préférences d'affichage seulement (jamais de signes ni de notes dans le stockage local). */
const SETTINGS_KEY = 'lsf.settings';

/** Réglages de l'application, mémorisés sur l'appareil. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly state = signal<AppSettings>(parseSettings(this.read()));

  /** Que fait un doigt sur le plateau de dessin. */
  readonly touchDrawing = computed(() => this.state().touchDrawing);
  /** Un stylet a déjà été utilisé sur cet appareil. */
  readonly penDetected = computed(() => this.state().penDetected);

  setTouchDrawing(touchDrawing: TouchDrawing): void {
    this.update({ touchDrawing });
  }

  /** Appelé dès qu'un stylet touche l'écran : en mode automatique, le doigt cesse alors de dessiner. */
  markPenDetected(): void {
    if (!this.state().penDetected) this.update({ penDetected: true });
  }

  resetPenDetected(): void {
    this.update({ penDetected: false });
  }

  private update(change: Partial<AppSettings>): void {
    this.state.update((s) => ({ ...s, ...change }));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.state()));
    } catch {
      // stockage indisponible (navigation privée) : réglages non conservés
    }
  }

  private read(): string | null {
    try {
      return localStorage.getItem(SETTINGS_KEY);
    } catch {
      return null;
    }
  }
}
