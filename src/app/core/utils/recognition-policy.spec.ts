import { describe, expect, it } from 'vitest';
import {
  AUTO_MARGIN,
  AUTO_REPLACE_SCORE,
  CONFUSION_SCORE,
  SUGGESTION_SCORE,
  decideMatches,
} from './recognition-policy';

const m = (...scores: number[]) => scores.map((score) => ({ score }));

describe('seuils', () => {
  it('le remplacement automatique démarre à 55 %', () => {
    expect(AUTO_REPLACE_SCORE).toBe(0.55);
    expect(SUGGESTION_SCORE).toBeLessThan(AUTO_REPLACE_SCORE);
    expect(CONFUSION_SCORE).toBeGreaterThan(AUTO_REPLACE_SCORE);
  });
});

describe('decideMatches', () => {
  it('aucun résultat ou score trop faible : rien reconnu', () => {
    expect(decideMatches([])).toBe('none');
    expect(decideMatches(m(0.3))).toBe('none');
    expect(decideMatches(m(SUGGESTION_SCORE - 0.01))).toBe('none');
  });

  it('entre le seuil des suggestions et celui du remplacement : suggestions', () => {
    expect(decideMatches(m(0.52))).toBe('suggest');
  });

  it('remplacement automatique dès 55 % quand le meilleur se détache nettement', () => {
    expect(decideMatches(m(0.55, 0.3))).toBe('auto');
    expect(decideMatches(m(0.9, 0.4, 0.2))).toBe('auto');
    expect(decideMatches(m(0.6))).toBe('auto'); // un seul candidat : aucune ambiguïté
  });

  it('deux signes aussi probables l\'un que l\'autre : on propose le choix au lieu de se tromper', () => {
    expect(decideMatches(m(0.7, 0.7 - AUTO_MARGIN + 0.01))).toBe('suggest');
    expect(decideMatches(m(0.9, 0.88))).toBe('suggest');
    expect(decideMatches(m(0.7, 0.7 - AUTO_MARGIN - 0.01))).toBe('auto');
  });

  it('un meilleur score sous 55 % n\'est jamais remplacé automatiquement', () => {
    expect(decideMatches(m(0.54, 0.1))).toBe('suggest');
  });
});
