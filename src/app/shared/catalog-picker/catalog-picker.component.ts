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
  /** Sélection multiple : utiliser `values` au lieu de `value`. */
  readonly multiple = input(false);
  readonly values = model<string[]>([]);
  /** "chips" : pastilles compactes ; "cards" : grandes cartes illustrées (configurations de main). */
  readonly layout = input<'chips' | 'cards'>('chips');

  protected readonly query = signal('');
  protected readonly selectedLabel = computed(() => {
    if (this.multiple()) {
      const names = this.values().map((id) => this.items().find((i) => i.id === id)?.name ?? id);
      return names.length ? names.join(' + ') : '—';
    }
    const item = this.items().find((i) => i.id === this.value());
    return item?.name ?? (this.value() === null && this.noneLabel() ? this.noneLabel()! : '—');
  });
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

  protected isSelected(id: string): boolean {
    return this.multiple() ? this.values().includes(id) : this.value() === id;
  }

  protected select(id: string | null): void {
    if (!this.multiple()) {
      this.value.set(id);
      return;
    }
    if (id === null) return;
    const current = this.values();
    this.values.set(current.includes(id) ? current.filter((v) => v !== id) : [...current, id]);
  }
}
