import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { CatalogItem } from '../../core/models/catalog.model';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Sélection d'un élément du catalogue (clé de main, emplacement, mouvement), groupé par catégorie. */
@Component({
  selector: 'app-catalog-picker',
  templateUrl: './catalog-picker.component.html',
  styleUrl: './catalog-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPickerComponent {
  readonly label = input.required<string>();
  readonly items = input.required<CatalogItem[]>();
  /** Si défini, ajoute une option "aucun" (valeur null). */
  readonly noneLabel = input<string | null>(null);
  readonly value = model<string | null>(null);
  /** "chips" : pastilles compactes ; "cards" : grandes cartes illustrées (configurations de main). */
  readonly layout = input<'chips' | 'cards'>('chips');

  protected readonly query = signal('');
  protected readonly selected = computed(() => this.items().find((i) => i.id === this.value()));
  protected readonly groups = computed(() => {
    const q = fold(this.query().trim());
    const groups = new Map<string, CatalogItem[]>();
    for (const item of this.items()) {
      if (q && !fold(item.name).includes(q) && !fold(item.category).includes(q)) continue;
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups].map(([category, items]) => ({ category, items }));
  });

  protected select(id: string | null): void {
    this.value.set(id);
  }
}
