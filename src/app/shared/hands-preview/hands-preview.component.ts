import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CatalogService } from '../../core/services/catalog.service';
import { HandSpec } from '../../core/models/sign.model';

export const SYMMETRIC_MOVEMENT = 'move_symmetric';

/** Le signe est-il symétrique (mouvement « symétrique » sur l'une des mains) ? */
export function isSymmetric(...hands: (HandSpec | null | undefined)[]): boolean {
  return hands.some((h) => h?.movementIds.includes(SYMMETRIC_MOVEMENT));
}

/**
 * Aperçu côte à côte des configurations des deux mains. En cas de symétrie, la main dominée
 * est affichée en miroir (gauche-droite) pour visualiser la paire.
 */
@Component({
  selector: 'app-hands-preview',
  template: `
    @if (hands().length) {
    <div class="preview" [class.symmetric]="symmetric()">
      @for (h of hands(); track h.label) {
        <figure [class.mirrored]="h.mirrored">
          <ol>
            @for (step of h.steps; track $index) {
              <li>
                @if (step.imageUrl; as url) {
                  <img [src]="url" [alt]="step.name + (h.mirrored ? ' (en miroir)' : '')" />
                } @else {
                  <span class="placeholder">{{ step.name }}</span>
                }
              </li>
            }
          </ol>
          <figcaption>{{ h.label }}</figcaption>
        </figure>
      }
    </div>
    }
    @if (hands().length && symmetric()) {
      <p class="hint">Symétrie : la main dominée est affichée en miroir.</p>
    }
  `,
  styles: `
    .preview {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 1rem;
    }
    figure {
      margin: 0;
      text-align: center;
    }
    ol {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li + li::before {
      content: '→';
      margin-right: 0.25rem;
      opacity: 0.6;
    }
    img,
    .placeholder {
      display: block;
      width: 88px;
      height: 88px;
      object-fit: contain;
      border-radius: 8px;
      background: #fff;
    }
    .placeholder {
      display: grid;
      place-items: center;
      padding: 0.25rem;
      border: 1px dashed var(--color-border);
      font-size: 0.75rem;
    }
    /* Miroir gauche-droite (axe vertical) de la main dominée. */
    .mirrored img {
      transform: scaleX(-1);
    }
    /* En miroir, l'ordre de lecture des étapes reste de gauche à droite. */
    figcaption {
      font-size: 0.8rem;
      opacity: 0.7;
    }
    .hint {
      margin: 0.35rem 0 0;
      text-align: center;
      font-size: 0.8rem;
      opacity: 0.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandsPreviewComponent {
  private readonly catalog = inject(CatalogService);
  readonly dominant = input<HandSpec | null | undefined>(null);
  readonly nonDominant = input<HandSpec | null | undefined>(null);

  protected readonly symmetric = computed(() => isSymmetric(this.dominant(), this.nonDominant()));
  protected readonly hands = computed(() => {
    const step = (id: string) => ({ name: this.catalog.find(id)?.name ?? id, imageUrl: this.catalog.find(id)?.imageUrl });
    const nonDominant = this.nonDominant();
    return [
      ...(this.dominant()?.handshapeIds.length
        ? [{ label: 'Main dominante', steps: this.dominant()!.handshapeIds.map(step), mirrored: false }]
        : []),
      ...(nonDominant?.handshapeIds.length
        ? [{ label: 'Main dominée', steps: nonDominant.handshapeIds.map(step), mirrored: this.symmetric() }]
        : []),
    ];
  });
}
