import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogSchema } from './catalog.schema';

const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/handshapes-catalog.json'), 'utf8'));
const accepts = (mutate: (c: any) => void) => {
  const c = structuredClone(raw);
  mutate(c);
  return catalogSchema.safeParse(c).success;
};

describe('catalogue', () => {
  it('le catalogue livré est valide', () => {
    const c = catalogSchema.parse(raw);
    expect(c.handshapes).toHaveLength(49);
    expect(c.zones.length).toBeGreaterThan(0);
    expect(c.movements.length).toBeGreaterThan(0);
    expect(c.orientations.length).toBeGreaterThan(0);
    expect(c.directions.length).toBeGreaterThan(0);
  });

  it('chaque image référencée existe dans public/', () => {
    const c = catalogSchema.parse(raw);
    for (const item of [...c.handshapes, ...c.movements]) {
      if (item.imageUrl) expect(() => readFileSync(resolve(process.cwd(), 'public' + item.imageUrl))).not.toThrow();
    }
  });

  it.each([
    ['identifiant en double', (c: any) => c.handshapes.push({ ...c.handshapes[0] })],
    ['image externe', (c: any) => (c.handshapes[0].imageUrl = 'https://evil.example/x.svg')],
    ['remontée de dossier', (c: any) => (c.handshapes[0].imageUrl = '/icons/../../x.svg')],
    ['identifiant invalide', (c: any) => (c.handshapes[0].id = 'Hand A')],
    ['champ inconnu', (c: any) => (c.handshapes[0].onclick = 'x')],
    ['liste vide', (c: any) => (c.handshapes = [])],
  ])('rejette : %s', (_label, mutate) => {
    expect(accepts(mutate)).toBe(false);
  });
});
