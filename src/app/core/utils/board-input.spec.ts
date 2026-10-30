import { describe, expect, it } from 'vitest';
import { PointerContext, decidePointerAction, fingerDraws, isTap } from './board-input';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

const base: PointerContext = {
  pointerType: 'touch',
  button: 0,
  tool: 'draw',
  touchDrawing: 'auto',
  penDetected: false,
  spaceDown: false,
  placing: false,
};
const ctx = (over: Partial<PointerContext>): PointerContext => ({ ...base, ...over });

describe('fingerDraws', () => {
  it('auto : le doigt dessine tant qu\'aucun stylet n\'a été détecté', () => {
    expect(fingerDraws('auto', false)).toBe(true);
    expect(fingerDraws('auto', true)).toBe(false);
  });

  it('draw / pan forcent le comportement, stylet ou non', () => {
    expect(fingerDraws('draw', true)).toBe(true);
    expect(fingerDraws('pan', false)).toBe(false);
  });
});

describe('decidePointerAction', () => {
  it('doigt sans stylet : dessine ; avec stylet détecté : déplace', () => {
    expect(decidePointerAction(ctx({}))).toBe('draw');
    expect(decidePointerAction(ctx({ penDetected: true }))).toBe('pan');
    expect(decidePointerAction(ctx({ penDetected: true, touchDrawing: 'draw' }))).toBe('draw');
    expect(decidePointerAction(ctx({ touchDrawing: 'pan' }))).toBe('pan');
  });

  it('le stylet et la souris dessinent toujours', () => {
    for (const pointerType of ['pen', 'mouse']) {
      expect(decidePointerAction(ctx({ pointerType, penDetected: true, touchDrawing: 'pan' }))).toBe('draw');
    }
  });

  it('l\'outil Signe se comporte comme le pinceau', () => {
    expect(decidePointerAction(ctx({ tool: 'sign', penDetected: true }))).toBe('pan');
    expect(decidePointerAction(ctx({ tool: 'sign', pointerType: 'pen' }))).toBe('draw');
  });

  it('souris : molette ou espace = déplacer, clic droit ignoré', () => {
    expect(decidePointerAction(ctx({ pointerType: 'mouse', button: 1 }))).toBe('pan');
    expect(decidePointerAction(ctx({ pointerType: 'mouse', spaceDown: true }))).toBe('pan');
    expect(decidePointerAction(ctx({ pointerType: 'mouse', button: 2 }))).toBe('ignore');
  });

  it('sélection, texte et pose d\'un signe ne dépendent pas du doigt ou du stylet', () => {
    expect(decidePointerAction(ctx({ tool: 'select', penDetected: true }))).toBe('select');
    expect(decidePointerAction(ctx({ tool: 'text', touchDrawing: 'pan' }))).toBe('text');
    expect(decidePointerAction(ctx({ placing: true, tool: 'draw' }))).toBe('place');
  });
});

describe('isTap', () => {
  it('un appui bref et immobile est un tap', () => {
    expect(isTap(2, 120)).toBe(true);
    expect(isTap(20, 120)).toBe(false);
    expect(isTap(2, 900)).toBe(false);
  });
});

describe('parseSettings', () => {
  it('valeurs par défaut sans réglage enregistré', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('relit des réglages valides', () => {
    expect(parseSettings('{"touchDrawing":"pan","penDetected":true}')).toEqual({ touchDrawing: 'pan', penDetected: true });
  });

  it('tolère un contenu invalide ou piégé', () => {
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"touchDrawing":"<script>","penDetected":"oui"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"__proto__":{"touchDrawing":"pan"}}')).toEqual(DEFAULT_SETTINGS);
  });
});
