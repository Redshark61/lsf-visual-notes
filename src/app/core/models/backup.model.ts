import { NotePage, UserSign } from './sign.model';

/** Format de fichier de sauvegarde (sans dépendance à Zod : chargé dès le démarrage). */
export const BACKUP_FORMAT = 'lsf-visual-notes';
/** v2 : ajout des configurations photographiées (customHandshapes). Les fichiers v1 restent lisibles. */
export const BACKUP_VERSION = 2;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2];

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
