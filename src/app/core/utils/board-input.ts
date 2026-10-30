/** Outils du plateau. */
export type BoardTool = 'select' | 'draw' | 'text' | 'sign';

/**
 * Que fait un doigt sur le plateau ?
 * - auto : il dessine, sauf si un stylet a été détecté (alors il déplace et zoome)
 * - draw : il dessine toujours
 * - pan  : il déplace toujours
 */
export type TouchDrawing = 'auto' | 'draw' | 'pan';

export type PointerAction = 'draw' | 'pan' | 'select' | 'text' | 'place' | 'ignore';

export function fingerDraws(setting: TouchDrawing, penDetected: boolean): boolean {
  return setting === 'draw' || (setting === 'auto' && !penDetected);
}

export interface PointerContext {
  pointerType: string;
  /** Bouton de la souris (0 = principal, 1 = molette, 2 = droit). */
  button: number;
  tool: BoardTool;
  touchDrawing: TouchDrawing;
  penDetected: boolean;
  /** Barre d'espace maintenue : déplacement à la souris. */
  spaceDown: boolean;
  /** Un signe choisi par la recherche attend d'être posé. */
  placing: boolean;
}

/** Action déclenchée par le premier pointeur (le geste à deux doigts est géré à part). */
export function decidePointerAction(c: PointerContext): PointerAction {
  if (c.pointerType === 'mouse') {
    if (c.button === 2) return 'ignore';
    if (c.button === 1 || c.spaceDown) return 'pan';
  }
  if (c.placing) return 'place';
  switch (c.tool) {
    case 'select':
      return 'select';
    case 'text':
      return 'text';
    case 'draw':
    case 'sign': {
      const isFinger = c.pointerType === 'touch';
      return isFinger && !fingerDraws(c.touchDrawing, c.penDetected) ? 'pan' : 'draw';
    }
  }
}

/** Mouvement (px) en dessous duquel un appui compte comme un simple « tap ». */
export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_DURATION_MS = 500;

export function isTap(movedPx: number, durationMs: number): boolean {
  return movedPx < TAP_MAX_MOVE_PX && durationMs < TAP_MAX_DURATION_MS;
}
