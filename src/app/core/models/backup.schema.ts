import * as z from 'zod/mini';
import { fr } from 'zod/locales';
import { CUSTOM_HANDSHAPE_ID_PATTERN, Catalog } from './catalog.model';
import { BACKUP_FORMAT, BACKUP_VERSION, Backup, SUPPORTED_BACKUP_VERSIONS } from './backup.model';
import { NORMALIZED_POINT_COUNT, MAX_BOUNDING_BOX_RATIO } from '../utils/gesture-geometry';

export { BACKUP_FORMAT, BACKUP_VERSION, type Backup, type BackupHandshape } from './backup.model';

// Messages d'erreur en français ; pas de new Function() (CSP stricte, voir vercel.json).
z.config({ ...fr(), jitless: true });

/** Garde-fous contre un fichier piégé ou corrompu (DoS local). */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_SIGNS = 10_000;
export const MAX_NOTES = 2_000;
export const MAX_ELEMENTS_PER_NOTE = 5_000;
export const MAX_CUSTOM_HANDSHAPES = 500;
/** ~750 Ko d'image ; nos photos ré-encodées font 20 à 40 Ko. */
const MAX_IMAGE_DATA_URL_LENGTH = 1_000_000;
/** Images matricielles uniquement : pas de SVG (qui peut contenir du script). */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Un glyphe de 32 points tient en quelques Ko ; au-delà, le fichier a été modifié. */
const MAX_SVG_PATH_LENGTH = 50_000;
/** Uniquement des commandes de tracé et des nombres : jamais de balise ni de script. */
const SVG_PATH_PATTERN = /^[MLQTCZmlqtcz0-9.,\s-]*$/;

const id = z.guid();
const timestamp = z.int().check(z.gte(0));
const text = (min: number, max: number) => z.string().check(z.minLength(min), z.maxLength(max));

/**
 * Schéma strict de sauvegarde. Les identifiants du catalogue (configurations, zones, mouvements)
 * doivent exister dans le catalogue chargé ; une configuration personnelle (hand_custom_…) doit
 * figurer dans le fichier ou déjà dans l'application (`existingCustomIds`).
 */
export function backupSchema(catalog: Catalog, existingCustomIds: ReadonlySet<string> = new Set()) {
  const ids = (items: { id: string }[]) => new Set(items.map((i) => i.id));
  const hands = ids(catalog.handshapes);
  const zones = ids(catalog.zones);
  const movements = ids(catalog.movements);
  const orientations = ids(catalog.orientations);
  const directions = ids(catalog.directions);
  const known = (set: Set<string>, what: string) =>
    z.string().check(z.refine((v) => set.has(v), `${what} inconnu(e) du catalogue`));
  const hand = z
    .string()
    .check(
      z.refine((v) => hands.has(v) || CUSTOM_HANDSHAPE_ID_PATTERN.test(v), 'Configuration inconnue du catalogue'),
    );

  const point = z.strictObject({
    x: z.number().check(z.gte(-2), z.lte(2)),
    y: z.number().check(z.gte(-2), z.lte(2)),
    pressure: z.optional(z.number().check(z.gte(0), z.lte(1))),
    strokeId: z.int().check(z.gte(1), z.lte(500)),
  });

  const glyph = z.strictObject({
    normalizedGesturePoints: z.array(point).check(z.length(NORMALIZED_POINT_COUNT)),
    boundingBoxRatio: z.number().check(z.gte(1 / MAX_BOUNDING_BOX_RATIO), z.lte(MAX_BOUNDING_BOX_RATIO)),
    strokeCount: z.int().check(z.gte(1), z.lte(500)),
    svgPathData: z.string().check(z.maxLength(MAX_SVG_PATH_LENGTH), z.regex(SVG_PATH_PATTERN)),
  });

  const sign = z.strictObject({
    id,
    word: text(1, 80),
    tags: z.array(text(1, 30)).check(z.maxLength(10)),
    anatomy: z.strictObject({
      dominantHandId: hand,
      dominantMovementId: known(movements, 'Mouvement'),
      dominantDirectionId: z.optional(known(directions, 'Direction')),
      dominantRepeated: z.optional(z.boolean()),
      dominantOrientationId: z.optional(known(orientations, 'Orientation')),
      nonDominantHandId: z.optional(hand),
      nonDominantMovementId: z.optional(known(movements, 'Mouvement')),
      nonDominantDirectionId: z.optional(known(directions, 'Direction')),
      nonDominantRepeated: z.optional(z.boolean()),
      nonDominantOrientationId: z.optional(known(orientations, 'Orientation')),
      locationZoneIds: z.array(known(zones, 'Emplacement')).check(z.maxLength(zones.size)),
    }),
    glyph: z.optional(glyph),
    note: z.optional(z.string().check(z.maxLength(2000))),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const note = z.strictObject({
    id,
    title: text(1, 120),
    elements: z
      .array(z.strictObject({ id, signId: id, orderIndex: z.int().check(z.gte(0)) }))
      .check(z.maxLength(MAX_ELEMENTS_PER_NOTE)),
    updatedAt: timestamp,
  });

  const customHandshape = z.strictObject({
    id: z.string().check(z.regex(CUSTOM_HANDSHAPE_ID_PATTERN)),
    name: text(1, 80),
    image: z.string().check(z.maxLength(MAX_IMAGE_DATA_URL_LENGTH), z.regex(IMAGE_DATA_URL_PATTERN)),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

  return z
    .strictObject({
      format: z.literal(BACKUP_FORMAT),
      version: z.union([z.literal(1), z.literal(2)]),
      exportedAt: z.string().check(z.maxLength(40)),
      customHandshapes: z.optional(
        z
          .array(customHandshape)
          .check(z.maxLength(MAX_CUSTOM_HANDSHAPES), z.refine(unique, 'Identifiants de configurations en double')),
      ),
      signs: z.array(sign).check(z.maxLength(MAX_SIGNS), z.refine(unique, 'Identifiants de signes en double')),
      notes: z.array(note).check(z.maxLength(MAX_NOTES), z.refine(unique, 'Identifiants de notes en double')),
    })
    .check(
      z.superRefine((backup, ctx) => {
        const available = new Set([...existingCustomIds, ...(backup.customHandshapes ?? []).map((h) => h.id)]);
        backup.signs.forEach((s, i) => {
          for (const key of ['dominantHandId', 'nonDominantHandId'] as const) {
            const id = s.anatomy[key];
            if (id && CUSTOM_HANDSHAPE_ID_PATTERN.test(id) && !available.has(id)) {
              ctx.addIssue({
                code: 'custom',
                path: ['signs', i, 'anatomy', key],
                message: 'Configuration personnelle absente du fichier',
                input: id,
              });
            }
          }
        });
      }),
    );
}

export type BackupParseResult = { ok: true; backup: Backup } | { ok: false; errors: string[] };

/**
 * Texte du fichier → sauvegarde validée. Ne lève jamais d'exception : renvoie des messages lisibles
 * (5 au plus) avec le chemin de l'erreur, ex. « signs[3].anatomy.dominantHandId : … ».
 */
export function parseBackup(
  raw: string,
  catalog: Catalog,
  existingCustomIds: ReadonlySet<string> = new Set(),
): BackupParseResult {
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, errors: ['Fichier trop volumineux (20 Mo maximum).'] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["Ce fichier n'est pas un JSON valide."] };
  }
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ["Ce fichier n'est pas une sauvegarde LSF Notes."] };
  }
  if (!SUPPORTED_BACKUP_VERSIONS.includes((json as { version?: unknown }).version as number)) {
    return { ok: false, errors: ['Version de sauvegarde non prise en charge.'] };
  }
  const result = backupSchema(catalog, existingCustomIds).safeParse(json);
  if (result.success) {
    // Normalisation v1 → v2 : pas de configurations personnelles.
    const data = result.data as Omit<Backup, 'customHandshapes' | 'version'> & { customHandshapes?: Backup['customHandshapes'] };
    return { ok: true, backup: { ...data, version: BACKUP_VERSION, customHandshapes: data.customHandshapes ?? [] } };
  }
  const errors = result.error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.reduce<string>(
      (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)),
      '',
    );
    return `${path || 'fichier'} : ${issue.message}`;
  });
  if (result.error.issues.length > 5) errors.push(`… et ${result.error.issues.length - 5} autre(s) erreur(s).`);
  return { ok: false, errors };
}
