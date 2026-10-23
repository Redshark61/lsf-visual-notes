/// <reference lib="webworker" />
import { db } from '../db/app.db';
import { RecognizerRequest, RecognizerResponse } from '../models/recognition.model';
import { SignGlyph } from '../models/sign.model';
import { NORMALIZED_POINT_COUNT, boundingBoxRatio, normalizeStrokes } from '../utils/gesture-geometry';
import { QTemplate, isCompatible, recognize, toTemplate } from './q-recognizer';

/**
 * Le Worker lit lui-même le dictionnaire dans IndexedDB (accessible depuis un Worker) :
 * le thread principal n'a pas à le charger ni à le transférer.
 * Les nuages sont stockés déjà normalisés ; seule la LUT $Q est calculée ici, une fois par
 * signe, et conservée tant que le signe n'est pas modifié (updatedAt).
 */
const cache = new Map<string, { updatedAt: number; template: QTemplate }>();
let templates: Promise<QTemplate[]> | null = null;

async function loadTemplates(): Promise<QTemplate[]> {
  const signs = await db.signs.toArray();
  const seen = new Set<string>();
  const result: QTemplate[] = [];
  for (const sign of signs) {
    const glyph = sign.glyph;
    if (!glyph || !isUsable(glyph)) continue; // entrée de lexique sans dessin
    seen.add(sign.id);
    let entry = cache.get(sign.id);
    if (!entry || entry.updatedAt !== sign.updatedAt) {
      entry = { updatedAt: sign.updatedAt, template: toTemplate({ id: sign.id, ...glyph }) };
      cache.set(sign.id, entry);
    }
    result.push(entry.template);
  }
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  return result;
}

function isUsable(glyph: SignGlyph): boolean {
  const pts = glyph.normalizedGesturePoints;
  return (
    Array.isArray(pts) &&
    pts.length === NORMALIZED_POINT_COUNT &&
    pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
    Number.isFinite(glyph.boundingBoxRatio) &&
    glyph.boundingBoxRatio > 0
  );
}

addEventListener('message', async ({ data }: MessageEvent<RecognizerRequest>) => {
  if (data.type === 'invalidate') {
    templates = null;
    return;
  }
  const { requestId, strokes } = data;
  try {
    const start = performance.now();
    templates ??= loadTemplates();
    const all = await templates;
    const nonEmpty = strokes.filter((s) => s.length > 0);
    const candidate = {
      normalizedPoints: normalizeStrokes(nonEmpty),
      strokeCount: nonEmpty.length,
      boundingBoxRatio: boundingBoxRatio(nonEmpty.flat()),
    };
    const response: RecognizerResponse = {
      type: 'result',
      requestId,
      matches: recognize(candidate, all),
      candidateCount: all.filter((t) => isCompatible(t, candidate)).length,
      durationMs: performance.now() - start,
    };
    postMessage(response);
  } catch (e) {
    templates = null; // retentera au prochain appel
    postMessage({ type: 'error', requestId, message: String(e) } satisfies RecognizerResponse);
  }
});
