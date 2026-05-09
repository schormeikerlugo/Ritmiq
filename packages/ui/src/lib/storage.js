/**
 * Helpers de Supabase Storage para portadas de playlists.
 */

import { supabase } from './supabase.js';

const BUCKET = 'playlist-covers';

/**
 * Sube un blob al bucket `playlist-covers` con path único por playlist+timestamp.
 * Devuelve la URL pública.
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.playlistId
 * @param {Blob} args.blob
 * @param {string} args.mime
 * @returns {Promise<string>} URL pública
 */
export async function uploadPlaylistCover({ userId, playlistId, blob, mime }) {
  const ext = mimeToExt(mime);
  // Path con userId + timestamp para que cada subida sea única (bust cache).
  const path = `${userId}/${playlistId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function mimeToExt(mime) {
  if (mime === 'image/png')  return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif')  return 'gif';
  return 'jpg';
}

/**
 * Reduce una imagen al tamaño máximo indicado (lado mayor) y la devuelve
 * como Blob JPEG con calidad 0.85. Útil para no subir 5MB por carátula.
 *
 * @param {File} file
 * @param {number} [maxSize]
 * @returns {Promise<{ blob: Blob, mime: string, dataUrl: string }>}
 */
export function resizeImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas no disponible'));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('No se pudo convertir la imagen'));
          resolve({
            blob,
            mime: 'image/jpeg',
            dataUrl: canvas.toDataURL('image/jpeg', 0.85),
          });
        }, 'image/jpeg', 0.85);
      };
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
