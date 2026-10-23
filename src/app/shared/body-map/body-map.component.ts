import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { CatalogItem } from '../../core/models/catalog.model';
import { BODY_OUTLINE, BODY_VIEWBOX, BODY_ZONES, BodyZoneGeometry } from './body-shapes';

/**
 * Silhouette cliquable : sélection multiple et ordonnée des zones (ordre = trajet du signe).
 * Les zones du catalogue sans géométrie restent sélectionnables via la liste sous la silhouette.
 */
@Component({
  selector: 'app-body-map',
  templateUrl: './body-map.component.html',
  styleUrl: './body-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodyMapComponent {
  readonly zones = input.required<CatalogItem[]>();
  readonly value = model<string[]>([]);

  protected readonly viewBox = BODY_VIEWBOX;
  protected readonly outline = BODY_OUTLINE;
  protected readonly mapped = computed(() =>
    this.zones()
      .filter((z) => BODY_ZONES[z.id])
      .map((z) => ({ zone: z, geometry: BODY_ZONES[z.id] as BodyZoneGeometry })),
  );
  protected readonly selectedZones = computed(() =>
    this.value()
      .map((id) => this.zones().find((z) => z.id === id))
      .filter((z): z is CatalogItem => !!z),
  );

  protected order(id: string): number {
    return this.value().indexOf(id) + 1;
  }

  protected toggle(id: string): void {
    const current = this.value();
    this.value.set(current.includes(id) ? current.filter((z) => z !== id) : [...current, id]);
  }

  protected onKey(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle(id);
    }
  }

  protected clear(): void {
    this.value.set([]);
  }
}
