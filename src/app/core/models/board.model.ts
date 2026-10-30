/**
 * Plateau de dessin libre d'une note (disposition « canvas ») : un plateau borné contenant des objets
 * vectoriels (encre, signes, texte), positionnés librement. Coordonnées en unités du plateau.
 */
export const BOARD_WIDTH = 3200;
export const BOARD_HEIGHT = 2400;

/** Garde-fous (modèle et sauvegarde importée). */
export const MAX_BOARD_OBJECTS = 3000;
export const MAX_INK_PATH_LENGTH = 40_000;
export const MAX_TEXT_LENGTH = 1_000;

/** Taille d'un signe à l'échelle 1 (côté du carré du glyphe). */
export const SIGN_BASE_SIZE = 72;
export const MIN_SIGN_SCALE = 0.3;
export const MAX_SIGN_SCALE = 8;

export const MIN_TEXT_SIZE = 10;
export const MAX_TEXT_SIZE = 300;
/** Petit, moyen, grand. */
export const TEXT_SIZES = [24, 36, 60] as const;

/** Épaisseur du pinceau, en pixels écran (ramenée aux unités du plateau selon le zoom). */
export const PEN_WIDTHS = { thin: 3, medium: 6, thick: 12 } as const;
export type PenWidth = keyof typeof PEN_WIDTHS;

export const INK_COLOR_DEFAULT = '#1d1d1f';

interface BoardObjectBase {
  id: string;
  /** Coin supérieur gauche de l'objet. */
  x: number;
  y: number;
}

/** Trait à main levée : contour rempli (perfect-freehand), chemin relatif à (x, y). */
export interface InkObject extends BoardObjectBase {
  type: 'ink';
  w: number;
  h: number;
  d: string;
  color: string;
}

/** Signe du dictionnaire (son dessin, sinon son mot). */
export interface SignObject extends BoardObjectBase {
  type: 'sign';
  signId: string;
  scale: number;
}

export interface TextObject extends BoardObjectBase {
  type: 'text';
  text: string;
  size: number;
  color: string;
}

export type BoardObject = InkObject | SignObject | TextObject;

/** Contenu d'une note en disposition « canvas ». */
export interface BoardContent {
  objects: BoardObject[];
}
