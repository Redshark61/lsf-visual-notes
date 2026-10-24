import { NotePage, UserSign } from './sign.model';

/** Format de fichier de sauvegarde (sans dépendance à Zod : chargé dès le démarrage). */
export const BACKUP_FORMAT = 'lsf-visual-notes';
/**
 * v2 : configurations photographiées (customHandshapes).
 * v3 : HandSpec par main (suites de configurations, plusieurs mouvements et directions).
 * Les fichiers v1 et v2 restent lisibles (convertis à l'import).
 */
export const BACKUP_VERSION = 3;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3];

/** Configuration personnelle dans un fichier de sauvegarde (image en data URL base64). */
export interface BackupHandshape {
  id: string;
  name: string;
  image: string;
  createdAt: number;
  updatedAt: number;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  customHandshapes: BackupHandshape[];
  signs: UserSign[];
  notes: NotePage[];
}
