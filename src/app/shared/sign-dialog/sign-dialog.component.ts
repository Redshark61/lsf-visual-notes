import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { SignDetailComponent } from '../sign-detail/sign-detail.component';
import { UserSign } from '../../core/models/sign.model';

/**
 * Fenêtre modale (<dialog> natif) affichant la définition d'un signe.
 * Ouverte tant que `sign` est défini ; les actions supplémentaires sont projetées (ng-content).
 */
@Component({
  selector: 'app-sign-dialog',
  imports: [SignDetailComponent],
  template: `
    <dialog #dialog aria-label="Définition du signe" (close)="closed.emit()" (click)="onClick($event)">
      <div class="body">
        @if (sign(); as s) {
          <app-sign-detail [sign]="s" />
        }
        <div class="actions">
          <ng-content />
          <button type="button" (click)="close()">Fermer</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(560px, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      padding: 0;
      border: none;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgb(0 0 0 / 25%);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 35%);
    }
    .body {
      padding: 1.25rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    button {
      font: inherit;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: #fff;
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignDialogComponent {
  readonly sign = input<UserSign | null>(null);
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.sign() && !dialog.open) dialog.showModal();
      else if (!this.sign() && dialog.open) dialog.close();
    });
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /** Clic sur le fond assombri (hors du contenu) : ferme la fenêtre. */
  protected onClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
