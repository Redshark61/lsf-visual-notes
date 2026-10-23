/** Photo source acceptée avant redimensionnement (les photos de smartphone font 3 à 12 Mo). */
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
export const HANDSHAPE_IMAGE_SIZE = 320;

/**
 * Photo de main → JPEG de HANDSHAPE_IMAGE_SIZE px max (sans recadrage).
 * Le ré-encodage via <canvas> supprime les métadonnées EXIF (dont la position GPS) ;
 * l'orientation EXIF est appliquée par le navigateur au décodage.
 */
export async function toHandshapeImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('Photo trop volumineuse (30 Mo maximum).');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('Image illisible (format non pris en charge par ce navigateur ?).');
    });
    const scale = Math.min(1, HANDSHAPE_IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), 'image/jpeg', 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** data:image/…;base64,… → Blob (entrée déjà validée par le schéma de sauvegarde). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
