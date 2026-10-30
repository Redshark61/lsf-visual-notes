import * as z from 'zod/mini';
import { fr } from 'zod/locales';
import { CUSTOM_HANDSHAPE_ID_PATTERN, Catalog } from './catalog.model';
import { BACKUP_FORMAT, BACKUP_VERSION, Backup, SUPPORTED_BACKUP_VERSIONS } from './backup.model';
import { SUPPORTED_POINT_COUNTS, MAX_BOUNDING_BOX_RATIO } from '../utils/gesture-geometry';
import { isSignV2, migrateSignV2 } from '../db/migrations';
import { findCompositionCycle } from '../utils/composition';
import {
  MAX_COMPONENTS,
  MAX_HANDSHAPE_SEQUENCE,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_MS,
  MIND_MAP_HEIGHT,
  MIND_MAP_WIDTH,
  VIDEO_MIME_TYPES,
} from './sign.model';
import { GLYPH_COLOR_PATTERN } from './glyph-colors';

export { BACKUP_FORMAT, BACKUP_VERSION, type Backup, type BackupHandshape, type BackupVideo } from './backup.model';

// Messages d'erreur en français ; pas de new Function() (CSP stricte, voir vercel.json).
z.config({ ...fr(), jitless: true });

/** Garde-fous contre un fichier piégé ou corrompu (DoS local). Vidéos comprises. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_SIGNS = 10_000;
export const MAX_NOTES = 2_000;
export const MAX_ELEMENTS_PER_NOTE = 5_000;
export const MAX_CUSTOM_HANDSHAPES = 500;
export const MAX_MAP_NODES = 500;
export const MAX_MAP_LINKS = 1_000;
/** ~750 Ko d'image ; nos photos ré-encodées font 20 à 40 Ko. */
const MAX_IMAGE_DATA_URL_LENGTH = 1_000_000;
/** Images matricielles uniquement : pas de SVG (qui peut contenir du script). */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Vidéos MP4 ou WebM uniquement, en base64 (~4/3 de la taille binaire). */
const VIDEO_DATA_URL_PATTERN = /^data:video\/(mp4|webm);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_VIDEO_DATA_URL_LENGTH = Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 64;
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

  const videoMime = z.enum(VIDEO_MIME_TYPES);
  const videoDuration = z.int().check(z.gte(0), z.lte(MAX_VIDEO_DURATION_MS * 2));

  const handSpec = z.strictObject({
    handshapeIds: z.array(hand).check(z.maxLength(MAX_HANDSHAPE_SEQUENCE)),
    movementIds: z.array(known(movements, 'Mouvement')).check(z.maxLength(movements.size)),
    directionIds: z.array(known(directions, 'Direction')).check(z.maxLength(directions.size)),
    repeated: z.optional(z.boolean()),
    orientationId: z.optional(known(orientations, 'Orientation')),
  });

  const point = z.strictObject({
    x: z.number().check(z.gte(-2), z.lte(2)),
    y: z.number().check(z.gte(-2), z.lte(2)),
    pressure: z.optional(z.number().check(z.gte(0), z.lte(1))),
    strokeId: z.int().check(z.gte(1), z.lte(500)),
  });

  const color = z.string().check(z.regex(GLYPH_COLOR_PATTERN));
  const svgPath = z.string().check(z.maxLength(MAX_SVG_PATH_LENGTH), z.regex(SVG_PATH_PATTERN));

  const glyph = z
    .strictObject({
      normalizedGesturePoints: z
        .array(point)
        .check(
          z.maxLength(Math.max(...SUPPORTED_POINT_COUNTS)),
          z.refine((pts) => SUPPORTED_POINT_COUNTS.includes(pts.length), 'Nuage de 32 ou 48 points attendu'),
        ),
      boundingBoxRatio: z.number().check(z.gte(1 / MAX_BOUNDING_BOX_RATIO), z.lte(MAX_BOUNDING_BOX_RATIO)),
      strokeCount: z.int().check(z.gte(1), z.lte(500)),
      svgPathData: svgPath,
      strokes: z.optional(z.array(z.strictObject({ d: svgPath, color: z.optional(color) })).check(z.maxLength(500))),
      color: z.optional(color),
    })
    .check(
      z.refine((g) => !g.strokes || g.strokes.length === g.strokeCount, 'Un tracé par trait est attendu (strokes)'),
    );

  const sign = z.strictObject({
    id,
    word: text(1, 80),
    tags: z.array(text(1, 30)).check(z.maxLength(10)),
    anatomy: z.strictObject({
      dominant: z.optional(handSpec),
      nonDominant: z.optional(handSpec),
      locationZoneIds: z.array(known(zones, 'Emplacement')).check(z.maxLength(zones.size)),
    }),
    glyph: z.optional(glyph),
    components: z.optional(z.array(id).check(z.maxLength(MAX_COMPONENTS))),
    video: z.optional(
      z.strictObject({
        mimeType: videoMime,
        durationMs: videoDuration,
        bytes: z.int().check(z.gte(1), z.lte(MAX_VIDEO_BYTES)),
      }),
    ),
    note: z.optional(z.string().check(z.maxLength(2000))),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

  const elements = z
    .array(z.strictObject({ id, signId: id, orderIndex: z.int().check(z.gte(0)) }))
    .check(z.maxLength(MAX_ELEMENTS_PER_NOTE));

  const mindMap = z
    .strictObject({
      nodes: z
        .array(
          z.strictObject({
            id,
            x: z.number().check(z.gte(0), z.lte(MIND_MAP_WIDTH)),
            y: z.number().check(z.gte(0), z.lte(MIND_MAP_HEIGHT)),
            elements,
          }),
        )
        .check(z.maxLength(MAX_MAP_NODES), z.refine(unique, 'Identifiants de bulles en double')),
      links: z
        .array(z.strictObject({ id, from: id, to: id, arrow: z.boolean() }))
        .check(z.maxLength(MAX_MAP_LINKS)),
    })
    .check(
      z.refine((map) => {
        const nodes = new Set(map.nodes.map((n) => n.id));
        return map.links.every((l) => nodes.has(l.from) && nodes.has(l.to) && l.from !== l.to);
      }, 'Lien vers une bulle inexistante'),
    );

  const note = z.strictObject({
    id,
    title: text(1, 120),
    elements,
    layout: z.optional(z.union([z.literal('linear'), z.literal('map')])),
    map: z.optional(mindMap),
    updatedAt: timestamp,
  });

  const customHandshape = z.strictObject({
    id: z.string().check(z.regex(CUSTOM_HANDSHAPE_ID_PATTERN)),
    name: text(1, 80),
    image: z.string().check(z.maxLength(MAX_IMAGE_DATA_URL_LENGTH), z.regex(IMAGE_DATA_URL_PATTERN)),
    createdAt: timestamp,
    updatedAt: timestamp,
  });


  return z
    .strictObject({
      format: z.literal(BACKUP_FORMAT),
      version: z.literal(BACKUP_VERSION),
      exportedAt: z.string().check(z.maxLength(40)),
      videos: z.optional(
        z
          .array(
            z.strictObject({
              signId: id,
              mimeType: videoMime,
              durationMs: videoDuration,
              data: z.string().check(z.maxLength(MAX_VIDEO_DATA_URL_LENGTH), z.regex(VIDEO_DATA_URL_PATTERN)),
            }),
          )
          .check(
            z.maxLength(MAX_SIGNS),
            z.refine((videos) => new Set(videos.map((v) => v.signId)).size === videos.length, 'Deux vidéos pour un même signe'),
          ),
      ),
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
        const signIds = new Set(backup.signs.map((s) => s.id));
        backup.signs.forEach((s, i) => {
          if (s.components?.includes(s.id)) {
            ctx.addIssue({ code: 'custom', path: ['signs', i, 'components'], message: 'Un signe ne peut pas se contenir lui-même', input: s.id });
          }
        });
        const cycle = findCompositionCycle(backup.signs);
        if (cycle) {
          const index = backup.signs.findIndex((s) => s.id === cycle);
          ctx.addIssue({ code: 'custom', path: ['signs', index, 'components'], message: 'Boucle de composition entre signes', input: cycle });
        }
        backup.videos?.forEach((v, i) => {
          if (!signIds.has(v.signId)) {
            ctx.addIssue({ code: 'custom', path: ['videos', i, 'signId'], message: 'Vidéo sans signe correspondant', input: v.signId });
          }
        });
        const available = new Set([...existingCustomIds, ...(backup.customHandshapes ?? []).map((h) => h.id)]);
        backup.signs.forEach((s, i) => {
          for (const key of ['dominant', 'nonDominant'] as const) {
            s.anatomy[key]?.handshapeIds.forEach((id, j) => {
              if (CUSTOM_HANDSHAPE_ID_PATTERN.test(id) && !available.has(id)) {
                ctx.addIssue({
                  code: 'custom',
                  path: ['signs', i, 'anatomy', key, 'handshapeIds', j],
                  message: 'Configuration personnelle absente du fichier',
                  input: id,
                });
              }
            });
          }
        });
      }),
    );
}

/**
 * Sauvegardes v1/v2 → v3 AVANT validation : seuls les signes au format à plat sont convertis
 * (déplacement de champs, aucune interprétation) ; le schéma strict v3 valide ensuite le résultat.
 */
function upgradeLegacy(json: Record<string, unknown>): Record<string, unknown> {
  if (json['version'] === BACKUP_VERSION) return json;
  const signs = json['signs'];
  // Seules les sauvegardes v1 et v2 contiennent des signes à plat ; v3 a déjà le format actuel.
  const flat = json['version'] === 1 || json['version'] === 2;
  return {
    ...json,
    version: BACKUP_VERSION,
    signs: flat && Array.isArray(signs) ? signs.map((s) => (isSignV2(s) ? migrateSignV2(s) : s)) : signs,
  };
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
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, errors: ['Fichier trop volumineux (100 Mo maximum).'] };
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
  const result = backupSchema(catalog, existingCustomIds).safeParse(upgradeLegacy(json as Record<string, unknown>));
  if (result.success) {
    const data = result.data as Omit<Backup, 'customHandshapes' | 'videos'> &
      Partial<Pick<Backup, 'customHandshapes' | 'videos'>>;
    return { ok: true, backup: { ...data, customHandshapes: data.customHandshapes ?? [], videos: data.videos ?? [] } };
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
