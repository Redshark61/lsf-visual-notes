import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface StepperItem {
  id: string;
  title: string;
}

/**
 * Menu de l'Atelier : les étapes, les éléments facultatifs (dessin, vidéo) et les actions (précédent,
 * suivant ou passer, enregistrer). Colonne à gauche dès la largeur tablette ; sur téléphone, bandeau
 * compact collé en haut de l'écran.
 * Couleurs : bleu = avancer, vert = enregistrer, neutre = reculer ou passer (« Passer » n'est jamais bleu).
 */
@Component({
  selector: 'app-wizard-stepper',
  template: `
    <nav aria-label="Création du signe">
      <ol class="steps">
        @for (s of steps(); track s.id; let i = $index) {
          <li>
            <button
              type="button"
              [class.current]="i === current()"
              [class.done]="i < current()"
              [disabled]="!reachable()[i]"
              [attr.aria-current]="i === current() ? 'step' : null"
              (click)="selected.emit(i)"
            >
              <span class="n">{{ i + 1 }}</span>
              <span class="t">{{ s.title }}</span>
            </button>
          </li>
        }
      </ol>

      <div class="extras" role="group" aria-label="Facultatif">
        <span class="group">Facultatif</span>
        <button type="button" class="extra" [class.has]="hasGlyph()" (click)="drawing.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" /></svg>
          Dessin
          @if (hasGlyph()) {
            <span class="check" aria-label="ajouté">✓</span>
          }
        </button>
        <button type="button" class="extra" [class.has]="hasVideo()" (click)="video.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>
          Vidéo
          @if (hasVideo()) {
            <span class="check" aria-label="ajoutée">✓</span>
          }
        </button>
      </div>

      <div class="actions">
        @if (blocker(); as b) {
          <p class="blocker" role="status">{{ b }}</p>
        }
        <button type="button" (click)="previous.emit()" [disabled]="!canGoBack()">Précédent</button>
        @if (!isLast()) {
          <button type="button" [class.next]="!skipping()" (click)="next.emit()" [disabled]="!canAdvance()">
            {{ skipping() ? 'Passer' : 'Suivant' }}
          </button>
        }
        @if (canSave()) {
          <button type="button" class="save" [class.main]="isLast()" (click)="save.emit()" [disabled]="saving()">
            {{ saving() ? 'Enregistrement…' : 'Enregistrer le signe' }}
          </button>
        }
      </div>
    </nav>
  `,
  styles: `
    nav {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.35rem 0;
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }
    ol {
      display: flex;
      gap: 0.25rem;
      margin: 0;
      padding: 0;
      list-style: none;
      overflow-x: auto;
    }
    li {
      flex: 1 0 auto;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.7rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: #fff;
      color: inherit;
      font: inherit;
      font-size: 0.9rem;
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    /* Étapes : de simples rubriques (pas de boîtes) */
    .steps button {
      width: 100%;
      padding: 0.4rem 0.5rem;
      border: none;
      border-bottom: 3px solid var(--color-border);
      border-radius: 0;
      background: none;
      text-align: left;
    }
    .steps button:disabled {
      cursor: default;
    }
    .done {
      border-bottom-color: #7d97b8;
    }
    .current {
      border-bottom-color: var(--color-primary);
      font-weight: 600;
    }
    .n {
      display: inline-grid;
      flex: 0 0 auto;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: #e6ebf2;
      font-size: 0.75rem;
    }
    .current .n {
      background: var(--color-primary);
      color: #fff;
    }
    .extras,
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }
    .group {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.6;
    }
    .extra svg {
      width: 1.1rem;
      height: 1.1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .extra.has {
      border-color: #2e7d32;
      color: #2e7d32;
    }
    .check {
      font-weight: 700;
    }
    .actions {
      justify-content: flex-end;
    }
    .blocker {
      flex: 1 1 100%;
      margin: 0;
      font-size: 0.85rem;
      color: #8a4a0f;
    }
    .next {
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: #fff;
    }
    .save {
      border: 2px solid #2e7d32;
      color: #2e7d32;
      font-weight: 600;
    }
    .save.main {
      background: #2e7d32;
      color: #fff;
    }
    /* Téléphone : bandeau compact, seul le titre de l'étape en cours est écrit. */
    @media (max-width: 640px) {
      .t {
        display: none;
      }
      .current .t {
        display: inline;
      }
    }
    /* Tablette et plus : colonne à gauche, qui reste visible pendant le défilement. */
    @media (min-width: 768px) {
      nav {
        top: 1rem;
        gap: 1rem;
        padding: 0;
        border-bottom: none;
        background: none;
      }
      ol {
        flex-direction: column;
        overflow: visible;
      }
      .steps button {
        padding: 0.6rem 0.75rem;
        border-bottom: none;
        border-left: 3px solid var(--color-border);
        font-size: 0.95rem;
      }
      .done {
        border-left-color: #7d97b8;
      }
      .current {
        border-left-color: var(--color-primary);
        background: #eef2f7;
      }
      .extras,
      .actions {
        flex-direction: column;
        align-items: stretch;
      }
      .extras button,
      .actions button {
        justify-content: center;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardStepperComponent {
  readonly steps = input.required<readonly StepperItem[]>();
  readonly current = input(0);
  readonly reachable = input<readonly boolean[]>([]);
  readonly hasGlyph = input(false);
  readonly hasVideo = input(false);
  readonly canGoBack = input(false);
  readonly isLast = input(false);
  readonly canAdvance = input(true);
  /** Étape facultative laissée vide : « Passer » (neutre) plutôt que « Suivant » (bleu). */
  readonly skipping = input(false);
  /** Le nom est saisi : on peut enregistrer à n'importe quelle étape. */
  readonly canSave = input(false);
  readonly saving = input(false);
  readonly blocker = input<string | null>(null);

  readonly selected = output<number>();
  readonly drawing = output<void>();
  readonly video = output<void>();
  readonly previous = output<void>();
  readonly next = output<void>();
  readonly save = output<void>();
}
