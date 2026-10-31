import { MAX_IMAGE_BYTES } from './feedback.js';

const MAX_EDGE = 2048;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be read. Try a JPEG, PNG or a screenshot.'));
    image.src = url;
  });
}

// Canvas re-encoding normalises PNG/HEIC/WebP to JPEG, applies EXIF orientation
// on iOS, and strips metadata before the photo is uploaded.
export async function prepareFeedbackImage(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Choose a photo under 25 MB.');
  let bitmap = null;
  let objectUrl = '';
  let source;
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file).catch(() => null);
    source = bitmap;
    if (!source) {
      objectUrl = URL.createObjectURL(file);
      source = await loadImage(objectUrl);
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('That image could not be read. Try a JPEG, PNG or a screenshot.');
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('That image could not be prepared. Try a screenshot instead.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('That image could not be prepared. Try a screenshot instead.')),
      'image/jpeg', 0.82,
    ));
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('Each photo must be under 10 MB. Try a smaller image.');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
