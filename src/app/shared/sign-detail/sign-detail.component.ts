import { GlyphPathsPipe } from '../glyph-paths.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogService } from '../../core/services/catalog.service';
import { UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { describeHand } from './describe-hand';
import { isSymmetric } from '../hands-preview/hands-preview.component';

/** Fiche complète d'un signe (Carnet, et plus tard liste du dictionnaire). */
@Component({
  selector: 'app-sign-detail',
  imports: [DatePipe, GlyphPathsPipe],
  templateUrl: './sign-detail.component.html',
  styleUrl: './sign-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignDetailComponent {
  protected readonly catalog = inject(CatalogService);
  readonly sign = input.required<UserSign>();

  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly hands = computed(() => {
    const a = this.sign().anatomy;
    const symmetric = isSymmetric(a.dominant, a.nonDominant);
    return [
      { label: 'Main dominante', hand: a.dominant, mirrored: false },
      ...(a.nonDominant ? [{ label: 'Main dominée', hand: a.nonDominant, mirrored: symmetric }] : []),
    ].map(({ label, hand, mirrored }) => ({
      label,
      mirrored,
      steps: hand.handshapeIds.map((id) => ({ id, name: this.catalog.find(id)?.name ?? id, imageUrl: this.catalog.find(id)?.imageUrl })),
      description: describeHand(this.catalog, hand),
    }));
  });
  protected readonly zones = computed(() =>
    this.sign().anatomy.locationZoneIds.map((id) => this.catalog.find(id)?.name ?? id),
  );

  constructor() {
    this.catalog.load().catch(() => undefined); // à défaut, les identifiants bruts sont affichés
  }
}
