import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

/** Titre de note avec un bouton « Renommer » explicite (Entrée valide, Échap annule). */
@Component({
  selector: 'app-note-title',
  template: `
    @if (editing()) {
      <form class="edit" (submit)="$event.preventDefault(); save()">
        <input
          #field
          aria-label="Nouveau titre de la note"
          [maxLength]="maxLength()"
          [value]="title()"
          (keydown.escape)="$event.stopPropagation(); cancel()"
        />
        <button type="submit" class="primary">Enregistrer</button>
        <button type="button" (click)="cancel()">Annuler</button>
      </form>
    } @else {
      <h1>{{ title() }}</h1>
      <button type="button" class="rename" (click)="edit()" [attr.aria-label]="'Renommer la note « ' + title() + ' »'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
        Renommer
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1 1 240px;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font-size: 1.2rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .edit {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    input {
      flex: 1 1 180px;
      min-width: 0;
      font: inherit;
      font-size: 1.1rem;
      font-weight: 600;
      padding: 0.3rem 0.5rem;
      border: 2px solid var(--color-primary);
      border-radius: 6px;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex: 0 0 auto;
      font: inherit;
      font-size: 0.9rem;
      padding: 0.3rem 0.7rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: #fff;
      color: inherit;
      cursor: pointer;
    }
    .primary {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }
    svg {
      width: 1em;
      height: 1em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linejoin: round;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteTitleComponent {
  readonly title = input.required<string>();
  readonly maxLength = input(120);
  /** Ouvre directement la saisie (ex. note qui vient d'être créée). */
  readonly startEditing = input(false);
  readonly renamed = output<string>();

  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  protected readonly editing = signal(false);

  constructor() {
    effect(() => {
      if (this.startEditing()) untracked(() => this.edit());
    });
  }

  protected edit(): void {
    this.editing.set(true);
    afterNextRender(
      () => {
        const field = this.field()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  protected save(): void {
    const value = this.field()?.nativeElement.value.trim();
    if (value && value !== this.title()) this.renamed.emit(value);
    this.editing.set(false);
  }

  protected cancel(): void {
    this.editing.set(false);
  }
}
