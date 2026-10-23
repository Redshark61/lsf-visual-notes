import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/** Événement non standard (Chrome, Edge, Android) absent de lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Préférence d'affichage seulement (jamais de signes ni de notes ici). */
const DISMISS_KEY = 'lsf.install.dismissedAt';
const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se présente comme un Mac, mais tactile.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Invitation à installer la PWA : indispensable sur iOS, où seules les apps installées
 * bénéficient d'un stockage durable. À instancier au démarrage (beforeinstallprompt est précoce).
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  readonly standalone = signal(isStandalone());
  readonly ios = isIos();
  private readonly deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
  private readonly dismissed = signal(recentlyDismissed());

  /** Bouton « Installer » natif disponible (Chrome, Edge, Android). */
  readonly canPrompt = computed(() => !!this.deferredPrompt());
  readonly showBanner = computed(
    () => !this.standalone() && !this.dismissed() && (this.canPrompt() || this.ios),
  );

  constructor() {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // on affiche notre propre bannière à la place de la mini-barre du navigateur
      this.deferredPrompt.set(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      this.deferredPrompt.set(null);
      this.standalone.set(true);
    };
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () => this.standalone.set(isStandalone());

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onDisplayMode);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplayMode);
    });
  }

  async install(): Promise<void> {
    const prompt = this.deferredPrompt();
    if (!prompt) return;
    this.deferredPrompt.set(null); // l'événement n'est utilisable qu'une fois
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'dismissed') this.dismiss();
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // navigation privée : la bannière reviendra au prochain lancement
    }
  }
}
