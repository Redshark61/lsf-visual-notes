import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { GLYPH_COLORS } from '../core/models/glyph-colors';

/** Choix d'une couleur de la palette des glyphes (null = noir / encre). */
@Component({
  selector: 'app-color-palette',
  template: `
    <span class="label" [id]="labelId">{{ label() }}</span>
    <div class="swatches" role="radiogroup" [attr.aria-labelledby]="labelId">
      @for (c of colors; track c.label) {
        <button
          type="button"
          role="radio"
          class="swatch"
          [style.background]="c.swatch"
          [attr.aria-checked]="value() === c.value"
          [attr.aria-label]="c.label"
          [title]="c.label"
          (click)="value.set(c.value)"
        ></button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .label {
      font-size: 0.9rem;
    }
    .swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .swatch {
      width: 2rem;
      height: 2rem;
      padding: 0;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px var(--color-border);
      cursor: pointer;
    }
    .swatch[aria-checked='true'] {
      box-shadow: 0 0 0 3px var(--color-primary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorPaletteComponent {
  private static nextId = 0;
  readonly label = input('Couleur :');
  readonly value = model<string | null>(null);
  protected readonly colors = GLYPH_COLORS;
  protected readonly labelId = `palette-${ColorPaletteComponent.nextId++}`;
}
