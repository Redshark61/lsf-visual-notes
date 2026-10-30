import { SIGN_BASE_SIZE } from '../models/board.model';
import { UserSign } from '../models/sign.model';
import { leafSigns } from './composition';

export type SignDisplay = 'signs' | 'words' | 'both';

export interface LayoutTile {
  kind: 'glyph' | 'word';
  x: number;
  y: number;
  /** Côté du glyphe (kind = 'glyph'). */
  size: number;
  glyphSignId?: string;
  /** Texte (kind = 'word'). */
  word?: string;
  fontSize?: number;
  width?: number;
  height?: number;
  /** Mot affiché dans un cadre pointillé : repli d'un signe sans dessin. */
  boxed?: boolean;
}

export interface SignLayout {
  width: number;
  height: number;
  tiles: LayoutTile[];
  /** Mot sous les glyphes (affichage « les deux »). */
  caption: { x: number; y: number; text: string; fontSize: number } | null;
}

const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.6;

/** Dessins à montrer pour un signe : le sien, sinon ceux de ses composants (signe composé). */
function glyphSigns(sign: UserSign, byId: ReadonlyMap<string, UserSign>): UserSign[] {
  if (sign.glyph) return [sign];
  return sign.components?.length ? leafSigns(sign, byId).filter((s) => !!s.glyph) : [];
}

/**
 * Mise en page d'un signe posé sur le plateau : glyphe seul, plusieurs glyphes (signe composé),
 * mot seul, ou glyphe + mot, selon l'affichage choisi. Un signe sans dessin s'affiche par son mot.
 */
export function signLayout(
  sign: UserSign | undefined,
  byId: ReadonlyMap<string, UserSign>,
  scale: number,
  display: SignDisplay,
): SignLayout {
  const unit = SIGN_BASE_SIZE * scale;
  const word = sign?.word ?? 'Signe supprimé';
  const glyphs = sign && display !== 'words' ? glyphSigns(sign, byId) : [];

  if (!glyphs.length) {
    // Mot seul : choisi (affichage « mots ») ou repli sans dessin (cadre pointillé).
    const boxed = display !== 'words';
    const fontSize = (boxed ? 22 : 30) * scale;
    const width = Math.max(boxed ? unit : unit * 0.5, textWidth(word, fontSize) + 14 * scale);
    const height = boxed ? unit * 0.6 : fontSize * 1.6;
    return { width, height, caption: null, tiles: [{ kind: 'word', x: 0, y: 0, size: height, word, fontSize, width, height, boxed }] };
  }

  const many = glyphs.length > 1;
  const size = many ? unit * 0.7 : unit;
  const gap = many ? unit * 0.06 : 0;
  const tiles: LayoutTile[] = glyphs.map((g, i) => ({
    kind: 'glyph',
    x: i * (size + gap),
    y: 0,
    size,
    glyphSignId: g.id,
  }));
  const glyphsWidth = glyphs.length * size + (glyphs.length - 1) * gap;

  if (display === 'both') {
    const fontSize = 18 * scale;
    const captionWidth = textWidth(word, fontSize);
    const width = Math.max(glyphsWidth, captionWidth);
    const offset = (width - glyphsWidth) / 2;
    return {
      width,
      height: size + fontSize * 1.5,
      tiles: tiles.map((t) => ({ ...t, x: t.x + offset })),
      caption: { x: width / 2, y: size + fontSize * 1.15, text: word, fontSize },
    };
  }
  return { width: glyphsWidth, height: size, tiles, caption: null };
}
