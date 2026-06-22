const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_BYTES = 12 * 1024 * 1024;

function saveImageFromDataUrl(dataUrl, subfolder) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Некорректный формат изображения');
  }
  const [, mime, base64] = match;
  const ext = ALLOWED_TYPES[mime];
  if (!ext) {
    throw new Error('Поддерживаются только JPEG, PNG и WebP');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Файл слишком большой (максимум 12 МБ)');
  }

  const dir = path.join(IMAGES_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  return `/images/${subfolder}/${filename}`;
}

function deleteImageByUrl(url) {
  if (!url || !url.startsWith('/images/')) return;
  const resolved = path.normalize(path.join(PUBLIC_DIR, url));
  if (!resolved.startsWith(IMAGES_DIR)) return;
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
}

module.exports = { saveImageFromDataUrl, deleteImageByUrl };
