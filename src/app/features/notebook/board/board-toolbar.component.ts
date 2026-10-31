import { ChangeDetectionStrategy, Component, input, model, output, signal } from '@angular/core';
import { PenWidth, TEXT_SIZES } from '../../../core/models/board.model';
import { BoardTool } from '../../../core/utils/board-input';
import { ColorPaletteComponent } from '../../../shared/color-palette.component';

interface ToolItem {
  value: BoardTool;
  label: string;
  /** Tracés SVG de l'icône (viewBox 24×24). */
  icon: string;
}

const TOOLS: ToolItem[] = [
  { value: 'select', label: 'Sélection', icon: 'M5 3l14 8-6 2 4 7-3 1-4-7-5 4z' },
  { value: 'draw', label: 'Pinceau', icon: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3' },
  { value: 'text', label: 'Texte', icon: 'M5 6h14M12 6v13M9 19h6' },
  { value: 'sign', label: 'Signe', icon: 'M5 18c2-8 5-12 7-12s2 5 0 8-1 5 3 4M17 6l2 2' },
  { value: 'erase', label: 'Gomme', icon: 'M4 15l9-9 6 6-6 6H8zM9 11l6 6' },
];

/**
 * Barre d'outils du plateau, en icônes seules (le nom de chaque bouton est dans son info-bulle et
 * pour les lecteurs d'écran) : ligne 1 = outils, annuler/rétablir, zoom ; ligne 2 = couleur et épaisseur
 * ou taille du texte.
 */
@Component({
  selector: 'app-board-toolbar',
  imports: [ColorPaletteComponent],
  template: `
    <div class="row" [class.open]="optionsOpen()">
      <div class="segmented tools" role="radiogroup" aria-label="Outil">
        @for (t of tools; track t.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="tool() === t.value"
            [attr.aria-label]="t.label"
            [title]="t.label"
            (click)="tool.set(t.value)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
          </button>
        }
      </div>

      <span class="spacer"></span>
      <button type="button" class="act" (click)="undo.emit()" [disabled]="!canUndo()" aria-label="Annuler" title="Annuler (Ctrl+Z)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
      </button>
      <button type="button" class="act" (click)="redo.emit()" [disabled]="!canRedo()" aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
      </button>
      <button
        type="button"
        class="act more-btn"
        [class.on]="optionsOpen()"
        [attr.aria-expanded]="optionsOpen()"
        aria-label="Options : zoom, couleur et épaisseur"
        title="Options"
        (click)="optionsOpen.set(!optionsOpen())"
      >
        <span class="dot" [style.background]="color() ?? '#1b1b1b'"></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="optionsOpen() ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'" /></svg>
      </button>
      <div class="zoom extra" [class.open]="optionsOpen()" role="group" aria-label="Zoom">
        <button type="button" class="act" (click)="zoomOut.emit()" aria-label="Dézoomer" title="Dézoomer">−</button>
        <span aria-live="polite">{{ zoomPercent() }} %</span>
        <button type="button" class="act" (click)="zoomIn.emit()" aria-label="Zoomer" title="Zoomer">+</button>
        <button type="button" class="act" (click)="fit.emit()" aria-label="Voir tout le contenu" title="Voir tout le contenu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>

    @if (tool() === 'draw' || tool() === 'sign' || tool() === 'text') {
      <div class="row extra" [class.open]="optionsOpen()">
        <app-color-palette label="" [(value)]="color" />
        @if (tool() === 'text') {
          <div class="segmented" role="radiogroup" aria-label="Taille du texte">
            @for (s of sizes; track s.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="textSize() === s.value"
                [attr.aria-label]="s.label"
                [title]="s.label"
                (click)="textSize.set(s.value)"
              >
                <span class="aa" [style.font-size.px]="s.glyph" aria-hidden="true">A</span>
              </button>
            }
          </div>
        } @else {
          <div class="segmented" role="radiogroup" aria-label="Épaisseur du pinceau">
            @for (w of widths; track w.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="penWidth() === w.value"
                [attr.aria-label]="w.label"
                [title]="w.label"
                (click)="penWidth.set(w.value)"
              >
                <svg class="line" viewBox="0 0 24 12" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6" [attr.stroke-width]="w.stroke" />
                </svg>
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--color-border);
      background: #fff;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.75rem;
    }
    .spacer {
      flex: 1;
    }
    .zoom {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
    }
    .zoom span {
      min-width: 3rem;
      text-align: center;
    }
    .act {
      display: inline-grid;
      place-items: center;
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0 0.5rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: #fff;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .act:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
    svg {
      width: 1.15rem;
      height: 1.15rem;
      vertical-align: middle;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .more-btn {
      display: none;
      gap: 0.3rem;
    }
    .more-btn.on {
      border-color: var(--color-primary);
    }
    .dot {
      width: 0.9rem;
      height: 0.9rem;
      border: 1px solid var(--color-border);
      border-radius: 50%;
    }
    /* Téléphone : une seule ligne d'outils ; zoom, couleur et épaisseur derrière le bouton « Options ». */
    @media (max-width: 600px) {
      .more-btn {
        display: inline-flex;
        align-items: center;
      }
      .extra:not(.open) {
        display: none;
      }
      .act {
        min-width: 2rem;
        padding: 0 0.3rem;
      }
      .row {
        flex-wrap: nowrap;
        gap: 0.3rem;
      }
      .row.open {
        flex-wrap: wrap;
      }
      .tools button[role='radio'] {
        padding: 0.35rem 0.5rem;
      }
    }
    .line {
      width: 1.6rem;
    }
    .aa {
      font-weight: 600;
      line-height: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardToolbarComponent {
  readonly tool = model<BoardTool>('draw');
  readonly color = model<string | null>(null);
  readonly penWidth = model<PenWidth>('medium');
  readonly textSize = model<number>(TEXT_SIZES[1]);
  protected readonly optionsOpen = signal(false);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly zoomPercent = input(100);

  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();

  protected readonly tools = TOOLS;
  /** `stroke` : épaisseur du trait d'exemple affiché sur le bouton. */
  protected readonly widths: { value: PenWidth; label: string; stroke: number }[] = [
    { value: 'thin', label: 'Pinceau fin', stroke: 2 },
    { value: 'medium', label: 'Pinceau moyen', stroke: 4 },
    { value: 'thick', label: 'Pinceau épais', stroke: 7 },
  ];
  /** `glyph` : taille (px) de la lettre d'exemple affichée sur le bouton. */
  protected readonly sizes = [
    { value: TEXT_SIZES[0], label: 'Petit texte', glyph: 12 },
    { value: TEXT_SIZES[1], label: 'Texte moyen', glyph: 16 },
    { value: TEXT_SIZES[2], label: 'Grand texte', glyph: 22 },
  ];
}
