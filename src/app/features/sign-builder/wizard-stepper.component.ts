import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface StepperItem {
  id: string;
  title: string;
}

/** Étapes de l'Atelier : fil horizontal sur téléphone, colonne à gauche dès la largeur tablette. */
@Component({
  selector: 'app-wizard-stepper',
  template: `
    <nav aria-label="Étapes">
      <ol>
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
    </nav>
  `,
  styles: `
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
      display: flex;
      align-items: center;
      gap: 0.4rem;
      width: 100%;
      padding: 0.4rem 0.5rem;
      border: none;
      border-bottom: 3px solid var(--color-border);
      background: none;
      font: inherit;
      font-size: 0.85rem;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.45;
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
    @media (max-width: 640px) {
      .t {
        display: none;
      }
      .current .t {
        display: inline;
      }
    }
    /* Tablette et plus : colonne verticale à gauche, qui reste visible pendant le défilement. */
    @media (min-width: 768px) {
      nav {
        position: sticky;
        top: 1rem;
      }
      ol {
        flex-direction: column;
        overflow: visible;
      }
      button {
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
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardStepperComponent {
  readonly steps = input.required<readonly StepperItem[]>();
  readonly current = input(0);
  readonly reachable = input<readonly boolean[]>([]);
  readonly selected = output<number>();
}
