export interface CatalogItem {
  id: string; // stable : référencé par les signes enregistrés, ne jamais renommer
  name: string;
  category: string;
  /** Illustration locale optionnelle (svg, png, jpg, webp) ; à défaut, le nom est affiché. */
  imageUrl?: string;
}

export type HandshapeItem = CatalogItem;

export interface CatalogSource {
  name: string;
  url: string;
  license: string;
  scope: string;
}

export interface Catalog {
  sources: CatalogSource[];
  handshapes: HandshapeItem[];
  zones: CatalogItem[];
  movements: CatalogItem[];
  /** Orientation de la paume. */
  orientations: CatalogItem[];
  /** Direction du mouvement. */
  directions: CatalogItem[];
}

/** Configuration photographiée par l'utilisateur (table IndexedDB customHandshapes). */
export interface CustomHandshape {
  id: string; // hand_custom_<32 hex> : compatible avec CATALOG_ID_PATTERN
  name: string;
  /** Photo ré-encodée (JPEG, 320 px max, sans métadonnées EXIF). */
  image: Blob;
  createdAt: number;
  updatedAt: number;
}

export const CUSTOM_HANDSHAPE_CATEGORY = 'Mes configurations';
export const CUSTOM_HANDSHAPE_ID_PATTERN = /^hand_custom_[a-f0-9]{32}$/;

export function newCustomHandshapeId(): string {
  return 'hand_custom_' + crypto.randomUUID().replaceAll('-', '');
}
