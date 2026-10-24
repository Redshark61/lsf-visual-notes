import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { CatalogPickerComponent } from '../catalog-picker/catalog-picker.component';
import { HandshapePhotoComponent } from '../handshape-photo/handshape-photo.component';
import { CatalogService } from '../../core/services/catalog.service';
import { HandSpec, MAX_HANDSHAPE_SEQUENCE } from '../../core/models/sign.model';

type Section = 'config' | 'movement' | 'direction' | 'orientation';
const STATIC_MOVEMENT = 'move_none';

/**
 * Édition d'une main en sections repliables : suite de configurations, mouvements (plusieurs),
 * directions (plusieurs) et répétition, orientation de la paume.
 */
@Component({
  selector: 'app-hand-editor',
  imports: [CatalogPickerComponent, HandshapePhotoComponent],
  templateUrl: './hand-editor.component.html',
  styleUrl: './hand-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandEditorComponent {
  protected readonly catalog = inject(CatalogService);
  readonly hand = model.required<HandSpec>();

  protected readonly maxSequence = MAX_HANDSHAPE_SEQUENCE;
  /** Étape de la suite en cours d'édition ; = longueur de la suite pour « configuration suivante ». */
  protected readonly activeSlot = signal(0);
  private readonly openSections = signal(new Set<Section>(['config']));

  protected readonly moving = computed(() => this.hand().movementIds.some((m) => m !== STATIC_MOVEMENT));
  protected readonly pendingSlot = computed(
    () => this.hand().handshapeIds.length > 0 && this.activeSlot() === this.hand().handshapeIds.length,
  );
  protected readonly configSummary = computed(() => this.names(this.hand().handshapeIds, ' → '));
  protected readonly movementSummary = computed(() => this.names(this.hand().movementIds, ' + '));
  protected readonly directionSummary = computed(() =>
    [this.names(this.hand().directionIds, ', '), this.hand().repeated ? 'répété' : ''].filter(Boolean).join(', '),
  );
  protected readonly orientationSummary = computed(() => this.names(this.hand().orientationId ? [this.hand().orientationId!] : [], ''));
  protected readonly sources = computed(() =>
    (this.catalog.catalog()?.sources ?? []).filter((s) => s.scope === 'handshapes'),
  );

  protected isOpen(section: Section): boolean {
    return this.openSections().has(section);
  }

  protected onToggle(section: Section, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openSections.update((set) => {
      const next = new Set(set);
      if (open) next.add(section);
      else next.delete(section);
      return next;
    });
  }

  protected item(id: string) {
    return this.catalog.find(id);
  }

  // --- Configurations

  protected setSlot(id: string | null): void {
    if (!id) return;
    const ids = [...this.hand().handshapeIds];
    ids[Math.min(this.activeSlot(), ids.length)] = id;
    const first = this.hand().handshapeIds.length === 0;
    this.patch({ handshapeIds: ids });
    // Premier choix : on enchaîne naturellement sur le mouvement.
    if (first && this.hand().movementIds.length === 0) this.openSections.update((s) => new Set([...s, 'movement']));
  }

  protected addSlot(): void {
    if (this.hand().handshapeIds.length < MAX_HANDSHAPE_SEQUENCE) this.activeSlot.set(this.hand().handshapeIds.length);
  }

  protected removeSlot(index: number): void {
    const ids = this.hand().handshapeIds.filter((_, i) => i !== index);
    this.patch({ handshapeIds: ids });
    this.activeSlot.set(Math.max(0, Math.min(this.activeSlot(), ids.length - 1)));
  }

  protected cancelPending(): void {
    this.activeSlot.set(Math.max(0, this.hand().handshapeIds.length - 1));
  }

  // --- Mouvements, directions, orientation

  /** « Aucun (statique) » est exclusif : il remplace les autres, et inversement. */
  protected setMovements(ids: string[]): void {
    const added = ids.find((id) => !this.hand().movementIds.includes(id));
    const movementIds =
      added === STATIC_MOVEMENT ? [STATIC_MOVEMENT] : ids.filter((id) => id !== STATIC_MOVEMENT || ids.length === 1);
    const moving = movementIds.some((m) => m !== STATIC_MOVEMENT);
    this.patch({
      movementIds,
      ...(moving ? {} : { directionIds: [], repeated: undefined }),
    });
  }

  protected setDirections(directionIds: string[]): void {
    this.patch({ directionIds });
  }

  protected setRepeated(repeated: boolean): void {
    this.patch({ repeated: repeated || undefined });
  }

  protected setOrientation(orientationId: string | null): void {
    this.patch({ orientationId: orientationId ?? undefined });
  }

  private patch(change: Partial<HandSpec>): void {
    const next: HandSpec = { ...this.hand(), ...change };
    if (next.repeated === undefined) delete next.repeated;
    if (next.orientationId === undefined) delete next.orientationId;
    this.hand.set(next);
  }

  private names(ids: string[], separator: string): string {
    return ids.map((id) => this.catalog.find(id)?.name ?? id).join(separator);
  }
}
