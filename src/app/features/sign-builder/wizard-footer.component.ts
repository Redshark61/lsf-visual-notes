import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Pied de page de l'assistant. Codes couleur : bleu = avancer, vert = valider ou enregistrer,
 * neutre = reculer, passer, refaire. « Passer » n'est jamais bleu : on ne le clique pas par réflexe.
 */
@Component({
  selector: 'app-wizard-footer',
  template: `
    <button type="button" (click)="previous.emit()" [disabled]="!canGoBack()">Précédent</button>
    <span class="blocker" role="status">{{ blocker() }}</span>
    <span class="end">
      @if (pendingVideo()) {
        <button type="button" (click)="retake.emit()">Refaire</button>
        <button type="button" class="confirm" (click)="useVideo.emit()">Utiliser cette vidéo</button>
      } @else {
        @if (isLast()) {
          <button type="button" class="confirm" (click)="save.emit()" [disabled]="saving()">
            {{ saving() ? 'Enregistrement…' : 'Enregistrer le signe' }}
          </button>
        } @else {
          @if (canSave()) {
            <button type="button" class="save" (click)="save.emit()" [disabled]="saving()">
              {{ saving() ? 'Enregistrement…' : 'Enregistrer le signe' }}
            </button>
          }
          <button type="button" [class.next]="!skipping()" (click)="next.emit()" [disabled]="!canAdvance()">
            {{ skipping() ? 'Passer cette étape' : 'Suivant' }}
          </button>
        }
      }
    </span>
  `,
  styles: `
    :host {
      position: sticky;
      bottom: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 0;
      background: var(--color-bg);
      border-top: 1px solid var(--color-border);
    }
    .blocker {
      flex: 1 1 10rem;
      text-align: right;
      font-size: 0.85rem;
      color: #8a4a0f;
    }
    .end {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    button {
      font: inherit;
      padding: 0.55rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: #fff;
      color: inherit;
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .next {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }
    .confirm {
      background: #2e7d32;
      border-color: #2e7d32;
      color: #fff;
      font-weight: 600;
    }
    .save {
      border-color: #2e7d32;
      color: #2e7d32;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardFooterComponent {
  readonly canGoBack = input(false);
  readonly isLast = input(false);
  readonly canAdvance = input(true);
  readonly blocker = input<string | null>(null);
  /** Étape facultative laissée vide : « Passer cette étape » (neutre) plutôt que « Suivant » (bleu). */
  readonly skipping = input(false);
  /** Le mot est saisi : on peut enregistrer à n'importe quelle étape. */
  readonly canSave = input(false);
  readonly saving = input(false);
  /** Une vidéo vient d'être filmée et attend sa validation. */
  readonly pendingVideo = input(false);

  readonly previous = output<void>();
  readonly next = output<void>();
  readonly save = output<void>();
  readonly useVideo = output<void>();
  readonly retake = output<void>();
}
