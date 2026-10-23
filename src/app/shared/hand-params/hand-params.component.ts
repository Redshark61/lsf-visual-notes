import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { CatalogPickerComponent } from '../catalog-picker/catalog-picker.component';
import { CatalogService } from '../../core/services/catalog.service';

/** Mouvement (+ direction, répétition) et orientation de la paume d'une main. */
@Component({
  selector: 'app-hand-params',
  imports: [CatalogPickerComponent],
  template: `
    <app-catalog-picker label="Mouvement" [items]="catalog.movements()" [(value)]="movementId" />
    @if (moving()) {
      <div class="row">
        <app-catalog-picker
          label="Direction"
          noneLabel="Non précisée"
          [items]="catalog.directions()"
          [(value)]="directionId"
        />
        <label class="repeat">
          <input type="checkbox" [checked]="repeated()" (change)="repeated.set($any($event.target).checked)" />
          Mouvement répété
        </label>
      </div>
    }
    <app-catalog-picker
      label="Orientation de la paume"
      noneLabel="Non précisée"
      [items]="catalog.orientations()"
      [(value)]="orientationId"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .repeat {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      align-self: flex-start;
      min-height: 2.25rem;
    }
    .repeat input {
      width: 1.15rem;
      height: 1.15rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandParamsComponent {
  protected readonly catalog = inject(CatalogService);
  readonly movementId = model<string | null>(null);
  readonly directionId = model<string | null>(null);
  readonly repeated = model(false);
  readonly orientationId = model<string | null>(null);

  /** Direction et répétition n'ont de sens que pour un mouvement réel. */
  protected readonly moving = computed(() => !!this.movementId() && this.movementId() !== 'move_none');
}
