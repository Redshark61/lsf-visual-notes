export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface StrokePoint extends Point {
  strokeId: number; // 1er trait, 2e trait...
}

/** Un trait = liste ordonnée de points. */
export type Stroke = Point[];

/** Glyphe rapide dessiné dans l'Atelier, prêt pour la reconnaissance $Q. */
export interface SignGlyph {
  /** Points pré-normalisés (32) pour $Q, calculés une seule fois à la sauvegarde. */
  normalizedGesturePoints: StrokePoint[];
  boundingBoxRatio: number;
  strokeCount: number;
  /** Chemin "M ... Z" de tous les traits dans un viewBox 0 0 100 100, jamais de balise <svg>. */
  svgPathData: string;
  /**
   * Les mêmes traits un par un, avec leur couleur d'affichage (#rrggbb ; absente = encre).
   * Une entrée par trait (strokes.length === strokeCount). La couleur n'influe pas sur la reconnaissance.
   */
  strokes?: GlyphStroke[];
  /** Ancien format : une seule couleur pour tout le glyphe (utilisée si `strokes` est absent). */
  color?: string;
}

export interface GlyphStroke {
  d: string;
  color?: string;
}

/** Longueur maximale d'une suite de configurations pour une main. */
export const MAX_HANDSHAPE_SEQUENCE = 5;

/** Paramètres manuels d'une main. */
export interface HandSpec {
  /** Suite de configurations, dans l'ordre (ex. index → main plate). Au moins une. */
  handshapeIds: string[];
  /** Mouvements combinés (ex. rotation + contact + symétrique). Au moins un (« move_none » si statique). */
  movementIds: string[];
  /** Directions du mouvement (vide si non précisé ou statique). */
  directionIds: string[];
  repeated?: boolean;
  /** Orientation de la paume. */
  orientationId?: string;
}

/** Seules la configuration et le mouvement de la main dominante sont obligatoires. */
export interface SignAnatomy {
  dominant: HandSpec;
  /** Absent pour un signe à une main. */
  nonDominant?: HandSpec;
  /** Zones dans l'ordre du trajet (ex. menton → torse). Peut être vide. */
  locationZoneIds: string[];
}

export interface UserSign {
  id: string; // UUID v4
  word: string;
  tags: string[];
  anatomy: SignAnatomy;
  /** Absent pour une simple entrée de lexique : le signe est alors ignoré par la reconnaissance. */
  glyph?: SignGlyph;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NoteElement {
  id: string;
  signId: string;
  orderIndex: number;
}

/** Dimensions de la surface d'une carte mentale (px CSS). */
export const MIND_MAP_WIDTH = 2400;
export const MIND_MAP_HEIGHT = 1600;

/** Bulle de carte mentale : une suite de signes, positionnée librement. */
export interface MapNode {
  id: string;
  x: number;
  y: number;
  elements: NoteElement[];
}

/** Lien entre deux bulles : flèche (de `from` vers `to`) ou simple trait. */
export interface MapLink {
  id: string;
  from: string;
  to: string;
  arrow: boolean;
}

export interface MindMap {
  nodes: MapNode[];
  links: MapLink[];
}

export interface NotePage {
  id: string;
  title: string;
  /** Contenu de la disposition « texte » (flux linéaire). */
  elements: NoteElement[];
  /** Absent = « linear ». */
  layout?: 'linear' | 'map';
  /** Contenu de la disposition « carte mentale ». */
  map?: MindMap;
  updatedAt: number;
}
