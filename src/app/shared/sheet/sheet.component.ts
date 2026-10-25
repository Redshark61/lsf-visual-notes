import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';

let nextId = 0;

/**
 * Fenêtre modale (<dialog> natif : focus piégé, Échap, fond assombri). Plein écran sur téléphone.
 *
 * Le contenu est instancié par le parent même fenêtre fermée : l'envelopper dans un
 * `@if (ouverte())` pour ne le créer qu'à l'ouverture (et libérer caméra, canevas… à la fermeture).
 * Les boutons d'action se mettent dans un élément `.sheet-actions` (style global, collé en bas).
 */
@Component({
  selector: 'app-sheet',
  template: `
    <dialog #dialog [attr.aria-labelledby]="titleId" (close)="closed.emit()" (click)="onBackdrop($event)">
      <div class="panel">
        <header>
          <h2 [id]="titleId">{{ title() }}</h2>
          <button type="button" class="close" aria-label="Fermer" (click)="hide()">×</button>
        </header>
        <div class="body"><ng-content /></div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(760px, 100vw);
      height: min(920px, calc(100dvh - 2rem));
      max-width: 100vw;
      max-height: 100dvh;
      padding: 0;
      border: none;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgb(0 0 0 / 25%);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 40%);
    }
    @media (max-width: 640px) {
      dialog {
        width: 100vw;
        height: 100dvh;
        border-radius: 0;
      }
    }
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0.6rem 0.6rem 1rem;
      border-bottom: 1px solid var(--color-border);
    }
    h2 {
      margin: 0;
      font-size: 1.1rem;
    }
    .close {
      width: 2.5rem;
      height: 2.5rem;
      border: none;
      border-radius: 50%;
      background: none;
      font-size: 1.6rem;
      line-height: 1;
      cursor: pointer;
    }
    .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 0;
      padding: 1rem;
      overflow: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetComponent {
  readonly title = input.required<string>();
  readonly closed = output<void>();

  protected readonly titleId = `sheet-title-${nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  show(): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  hide(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
  }

  /** Clic sur le fond assombri (le panneau remplit la fenêtre : seul le fond est ciblé). */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.hide();
  }
}
