import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
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

/** Barre d'outils du plateau : outil, couleur, épaisseur ou taille de texte, annuler/rétablir, zoom. */
@Component({
  selector: 'app-board-toolbar',
  imports: [ColorPaletteComponent],
  template: `
    <!-- Ligne 1 : outils, annuler / rétablir, zoom. -->
    <div class="row">
      <div class="segmented" role="radiogroup" aria-label="Outil">
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
            <span class="txt">{{ t.label }}</span>
          </button>
        }
      </div>

      <span class="spacer"></span>
      <button type="button" class="act" (click)="undo.emit()" [disabled]="!canUndo()" aria-label="Annuler" title="Annuler (Ctrl+Z)">
        <span class="long">Annuler</span><span class="short" aria-hidden="true">↶</span>
      </button>
      <button type="button" class="act" (click)="redo.emit()" [disabled]="!canRedo()" aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z)">
        <span class="long">Rétablir</span><span class="short" aria-hidden="true">↷</span>
      </button>
      <div class="zoom" role="group" aria-label="Zoom">
        <button type="button" class="act" (click)="zoomOut.emit()" aria-label="Dézoomer">−</button>
        <span aria-live="polite">{{ zoomPercent() }} %</span>
        <button type="button" class="act" (click)="zoomIn.emit()" aria-label="Zoomer">+</button>
        <button type="button" class="act" (click)="fit.emit()" title="Voir tout le contenu">Ajuster</button>
      </div>
    </div>

    <!-- Ligne 2 : couleur et taille, selon l'outil. -->
    @if (tool() === 'draw' || tool() === 'sign' || tool() === 'text') {
      <div class="row">
        <app-color-palette label="" [(value)]="color" />
        @if (tool() === 'text') {
          <div class="segmented" role="radiogroup" aria-label="Taille du texte">
            @for (s of sizes; track s.value) {
              <button type="button" role="radio" [attr.aria-checked]="textSize() === s.value" (click)="textSize.set(s.value)">
                {{ s.label }}
              </button>
            }
          </div>
        } @else {
          <div class="segmented" role="radiogroup" aria-label="Épaisseur du pinceau">
            @for (w of widths; track w.value) {
              <button type="button" role="radio" [attr.aria-checked]="penWidth() === w.value" (click)="penWidth.set(w.value)">
                {{ w.label }}
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
      min-width: 3.2rem;
      text-align: center;
    }
    .act {
      font: inherit;
      padding: 0.3rem 0.65rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: #fff;
      color: inherit;
      cursor: pointer;
    }
    .act:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    .segmented svg {
      width: 1rem;
      height: 1rem;
      vertical-align: -0.15rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .txt {
      margin-left: 0.2rem;
    }
    /* Petits écrans : icônes seules, pour que la première ligne tienne. */
    @media (max-width: 640px) {
      .txt,
      .long {
        display: none;
      }
    }
    @media (min-width: 641px) {
      .short {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardToolbarComponent {
  readonly tool = model<BoardTool>('draw');
  readonly color = model<string | null>(null);
  readonly penWidth = model<PenWidth>('medium');
  readonly textSize = model<number>(TEXT_SIZES[1]);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly zoomPercent = input(100);

  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();

  protected readonly tools = TOOLS;
  protected readonly widths: { value: PenWidth; label: string }[] = [
    { value: 'thin', label: 'Fin' },
    { value: 'medium', label: 'Moyen' },
    { value: 'thick', label: 'Épais' },
  ];
  protected readonly sizes = [
    { value: TEXT_SIZES[0], label: 'Petit' },
    { value: TEXT_SIZES[1], label: 'Moyen' },
    { value: TEXT_SIZES[2], label: 'Grand' },
  ];
}
