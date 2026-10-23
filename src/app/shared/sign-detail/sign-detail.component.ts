import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogService } from '../../core/services/catalog.service';
import { UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { describeHand } from './describe-hand';

/** Fiche complète d'un signe (Carnet, et plus tard liste du dictionnaire). */
@Component({
  selector: 'app-sign-detail',
  imports: [DatePipe],
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
    const hands = [
      {
        label: 'Main dominante',
        handId: a.dominantHandId,
        description: describeHand(this.catalog, {
          movementId: a.dominantMovementId,
          directionId: a.dominantDirectionId,
          repeated: a.dominantRepeated,
          orientationId: a.dominantOrientationId,
        }),
      },
    ];
    if (a.nonDominantHandId) {
      hands.push({
        label: 'Main dominée',
        handId: a.nonDominantHandId,
        description: describeHand(this.catalog, {
          movementId: a.nonDominantMovementId,
          directionId: a.nonDominantDirectionId,
          repeated: a.nonDominantRepeated,
          orientationId: a.nonDominantOrientationId,
        }),
      });
    }
    return hands.map((h) => ({ ...h, hand: this.catalog.find(h.handId) }));
  });
  protected readonly zones = computed(() =>
    this.sign().anatomy.locationZoneIds.map((id) => this.catalog.find(id)?.name ?? id),
  );

  constructor() {
    this.catalog.load().catch(() => undefined); // à défaut, les identifiants bruts sont affichés
  }
}
