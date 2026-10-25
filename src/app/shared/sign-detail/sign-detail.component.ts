import { GlyphPathsPipe } from '../glyph-paths.pipe';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogService } from '../../core/services/catalog.service';
import { StorageService } from '../../core/services/storage.service';
import { BlobVideoComponent } from '../blob-video.component';
import { UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { describeHand } from './describe-hand';
import { isSymmetric } from '../hands-preview/hands-preview.component';
import { isEmptyHand } from '../../core/utils/hand-spec';

/** Fiche complète d'un signe (Carnet, et plus tard liste du dictionnaire). */
@Component({
  selector: 'app-sign-detail',
  imports: [DatePipe, GlyphPathsPipe, BlobVideoComponent],
  templateUrl: './sign-detail.component.html',
  styleUrl: './sign-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignDetailComponent {
  protected readonly catalog = inject(CatalogService);
  private readonly storage = inject(StorageService);
  readonly sign = input.required<UserSign>();
  /** Vidéo chargée à la demande (table séparée). */
  protected readonly video = signal<Blob | null>(null);
  protected readonly shareError = signal<string | null>(null);

  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly hands = computed(() => {
    const a = this.sign().anatomy;
    const symmetric = isSymmetric(a.dominant, a.nonDominant);
    return [
      { label: 'Main dominante', hand: a.dominant, mirrored: false },
      { label: 'Main dominée', hand: a.nonDominant, mirrored: symmetric },
    ]
      .filter((h) => !isEmptyHand(h.hand))
      .map(({ label, hand, mirrored }) => ({
        label,
        mirrored,
        steps: hand!.handshapeIds.map((id) => ({
          id,
          name: this.catalog.find(id)?.name ?? id,
          imageUrl: this.catalog.find(id)?.imageUrl,
        })),
        description: describeHand(this.catalog, hand),
      }));
  });
  protected readonly zones = computed(() =>
    this.sign().anatomy.locationZoneIds.map((id) => this.catalog.find(id)?.name ?? id),
  );

  constructor() {
    this.catalog.load().catch(() => undefined); // à défaut, les identifiants bruts sont affichés
    effect(() => {
      const sign = this.sign();
      this.video.set(null);
      this.shareError.set(null);
      if (sign.video) {
        this.storage.getVideo(sign.id).then((v) => {
          if (this.sign().id === sign.id) this.video.set(v?.blob ?? null);
        });
      }
    });
  }

  /** Feuille de partage du système (Fichiers, Photos…), sinon téléchargement. */
  protected async saveVideo(): Promise<void> {
    const blob = this.video();
    if (!blob) return;
    const extension = blob.type === 'video/webm' ? 'webm' : 'mp4';
    const file = new File([blob], `${this.sign().word.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.${extension}`, {
      type: blob.type,
    });
    this.shareError.set(null);
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: this.sign().word });
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.shareError.set(`Impossible d'enregistrer la vidéo : ${e}`);
    }
  }
}
