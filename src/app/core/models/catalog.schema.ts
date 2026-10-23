import * as z from 'zod/mini';

// Pas de new Function() : compatible avec la CSP stricte (script-src 'self', voir vercel.json).
z.config({ jitless: true });

export const CATALOG_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

const catalogItemSchema = z.strictObject({
  id: z.string().check(z.regex(CATALOG_ID_PATTERN)),
  name: z.string().check(z.minLength(1), z.maxLength(80)),
  category: z.string().check(z.minLength(1), z.maxLength(40)),
  // Uniquement des images locales du dossier public/icons (affichées via <img>, jamais injectées).
  imageUrl: z.optional(z.string().check(z.regex(/^\/icons\/[a-z0-9_\-/]+\.(svg|png|jpe?g|gif|webp)$/))),
});

const uniqueIds = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;
const itemList = z.array(catalogItemSchema).check(z.minLength(1), z.refine(uniqueIds, 'Identifiants en double'));

export const catalogSchema = z.strictObject({
  sources: z.array(z.strictObject({ name: z.string(), url: z.url(), license: z.string(), scope: z.string() })),
  handshapes: itemList,
  zones: itemList,
  movements: itemList,
  orientations: itemList,
  directions: itemList,
});
