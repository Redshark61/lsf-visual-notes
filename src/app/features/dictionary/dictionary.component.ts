import { GlyphPathsPipe } from '../../shared/glyph-paths.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { StorageService } from '../../core/services/storage.service';
import { UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { SignDialogComponent } from '../../shared/sign-dialog/sign-dialog.component';

type Sort = 'alpha' | 'recent';

/** Toutes les configurations d'un signe (suites des deux mains). */
const handshapesOf = (s: UserSign) => [
  ...(s.anatomy.dominant?.handshapeIds ?? []),
  ...(s.anatomy.nonDominant?.handshapeIds ?? []),
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

@Component({
  selector: 'app-dictionary',
  imports: [RouterLink, SignDialogComponent, GlyphPathsPipe],
  templateUrl: './dictionary.component.html',
  styleUrl: './dictionary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DictionaryComponent {
  protected readonly catalog = inject(CatalogService);
  private readonly storage = inject(StorageService);

  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly signs = signal<UserSign[] | null>(null);
  protected readonly query = signal('');
  protected readonly handId = signal('');
  protected readonly tag = signal<string | null>(null);
  protected readonly sort = signal<Sort>('alpha');
  protected readonly detail = signal<UserSign | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Configurations réellement utilisées (dominante ou dominée), pour le filtre. */
  protected readonly usedHands = computed(() => {
    const ids = new Set((this.signs() ?? []).flatMap((s) => handshapesOf(s)));
    return this.catalog.handshapes().filter((h) => ids.has(h.id));
  });
  protected readonly allTags = computed(() =>
    [...new Set((this.signs() ?? []).flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b, 'fr')),
  );
  protected readonly filtered = computed(() => {
    const q = fold(this.query().trim());
    const hand = this.handId();
    const tag = this.tag();
    const list = (this.signs() ?? []).filter(
      (s) =>
        (!q || fold(s.word).includes(q) || s.tags.some((t) => fold(t).includes(q)) || fold(s.note ?? '').includes(q)) &&
        (!hand || handshapesOf(s).includes(hand)) &&
        (!tag || s.tags.includes(tag)),
    );
    return this.sort() === 'alpha'
      ? list.sort((a, b) => a.word.localeCompare(b.word, 'fr', { sensitivity: 'base' }))
      : list.sort((a, b) => b.createdAt - a.createdAt);
  });
  protected readonly hasFilters = computed(() => !!(this.query() || this.handId() || this.tag()));

  constructor() {
    this.catalog.load().catch(() => undefined);
    this.reload();
  }

  private reload(): void {
    this.storage
      .listSigns()
      .then((signs) => this.signs.set(signs))
      .catch((e) => this.error.set(`Impossible de lire le dictionnaire : ${e}`));
  }

  protected handImage(id: string): string | undefined {
    return this.catalog.find(id)?.imageUrl;
  }

  protected toggleTag(tag: string): void {
    this.tag.update((t) => (t === tag ? null : tag));
  }

  protected resetFilters(): void {
    this.query.set('');
    this.handId.set('');
    this.tag.set(null);
  }

  protected async remove(sign: UserSign): Promise<void> {
    const uses = await this.storage.countNotesUsing(sign.id);
    const warning = uses
      ? `\n\nIl est utilisé dans ${uses} note${uses > 1 ? 's' : ''}, où il apparaîtra comme « signe supprimé ».`
      : '';
    if (!confirm(`Supprimer « ${sign.word} » du dictionnaire ?${warning}`)) return;
    await this.storage.deleteSign(sign.id);
    this.detail.set(null);
    this.signs.update((list) => (list ?? []).filter((s) => s.id !== sign.id));
  }
}
