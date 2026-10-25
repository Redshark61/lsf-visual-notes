import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Boutons flottants de l'Atelier (en bas à droite). Dessin et vidéo : icônes (chacune ouvre une
 * fenêtre). Navigation : bleu = avancer, vert = enregistrer, neutre = reculer ou passer
 * (« Passer » n'est jamais bleu : on ne le clique pas par réflexe).
 */
@Component({
  selector: 'app-wizard-fabs',
  template: `
    @if (blocker(); as b) {
      <span class="blocker" role="status">{{ b }}</span>
    }
    <div class="row">
      <button type="button" class="round" (click)="video.emit()" [class.has]="hasVideo()" title="Vidéo du signe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>
        <span class="sr-only">{{ hasVideo() ? 'Vidéo du signe (enregistrée)' : 'Ajouter une vidéo' }}</span>
      </button>
      <button type="button" class="round" (click)="drawing.emit()" [class.has]="hasGlyph()" title="Dessin du signe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></svg>
        <span class="sr-only">{{ hasGlyph() ? 'Dessin du signe (enregistré)' : 'Ajouter un dessin' }}</span>
      </button>
    </div>
    <div class="row">
      <button type="button" class="round" (click)="previous.emit()" [disabled]="!canGoBack()" title="Étape précédente">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        <span class="sr-only">Précédent</span>
      </button>
      @if (!isLast()) {
        <button type="button" class="pill" [class.next]="!skipping()" (click)="next.emit()" [disabled]="!canAdvance()">
          {{ skipping() ? 'Passer' : 'Suivant' }}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      }
      @if (canSave()) {
        <button type="button" class="pill save" [class.main]="isLast()" (click)="save.emit()" [disabled]="saving()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      right: max(1rem, env(safe-area-inset-right));
      bottom: max(1rem, env(safe-area-inset-bottom));
      z-index: 30;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.6rem;
      pointer-events: none;
    }
    :host > * {
      pointer-events: auto;
    }
    .row {
      display: flex;
      gap: 0.6rem;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      font: inherit;
      border: 1px solid var(--color-border);
      background: #fff;
      color: inherit;
      box-shadow: 0 3px 10px rgb(0 0 0 / 22%);
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .round {
      position: relative;
      width: 3rem;
      height: 3rem;
      padding: 0;
      border-radius: 50%;
    }
    .round.has {
      border: 2px solid #2e7d32;
      color: #2e7d32;
    }
    .round.has::after {
      content: '✓';
      position: absolute;
      top: -0.35rem;
      right: -0.35rem;
      display: grid;
      place-items: center;
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 50%;
      background: #2e7d32;
      color: #fff;
      font-size: 0.7rem;
    }
    .pill {
      height: 3rem;
      padding: 0 1.1rem;
      border-radius: 999px;
      font-weight: 600;
    }
    .next {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }
    .save {
      border: 2px solid #2e7d32;
      color: #2e7d32;
    }
    .save.main {
      background: #2e7d32;
      color: #fff;
    }
    svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .blocker {
      max-width: 16rem;
      padding: 0.4rem 0.8rem;
      border-radius: 10px;
      background: #fff3d6;
      color: #6b3d08;
      font-size: 0.85rem;
      box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardFabsComponent {
  readonly canGoBack = input(false);
  readonly isLast = input(false);
  readonly canAdvance = input(true);
  readonly blocker = input<string | null>(null);
  /** Étape facultative laissée vide : « Passer » (neutre) plutôt que « Suivant » (bleu). */
  readonly skipping = input(false);
  /** Le nom est saisi : on peut enregistrer à n'importe quelle étape. */
  readonly canSave = input(false);
  readonly saving = input(false);
  readonly hasGlyph = input(false);
  readonly hasVideo = input(false);

  readonly previous = output<void>();
  readonly next = output<void>();
  readonly save = output<void>();
  readonly drawing = output<void>();
  readonly video = output<void>();
}
