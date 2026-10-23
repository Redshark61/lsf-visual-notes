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
  /** Chemin "M ... Z" dans un viewBox 0 0 100 100, jamais de balise <svg>. */
  svgPathData: string;
}

/**
 * Paramètres manuels du signe, pour chaque main : configuration, mouvement (+ direction, répétition),
 * orientation de la paume. Seuls la configuration et le mouvement de la main dominante sont obligatoires.
 */
export interface SignAnatomy {
  dominantHandId: string;
  dominantMovementId: string;
  dominantDirectionId?: string;
  dominantRepeated?: boolean;
  dominantOrientationId?: string;
  nonDominantHandId?: string;
  nonDominantMovementId?: string;
  nonDominantDirectionId?: string;
  nonDominantRepeated?: boolean;
  nonDominantOrientationId?: string;
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

export interface NotePage {
  id: string;
  title: string;
  elements: NoteElement[];
  updatedAt: number;
}
