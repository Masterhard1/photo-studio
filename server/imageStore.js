const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_DIMENSION = 2400;

function matchesSignature(buffer, mime) {
  if (buffer.length < 12) return false;
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    );
  }
  return false;
}

async function recompress(buffer, mime) {
  let image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  if ((metadata.width || 0) > MAX_DIMENSION || (metadata.height || 0) > MAX_DIMENSION) {
    image = image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  }
  if (mime === 'image/jpeg') return image.jpeg({ quality: 82 }).toBuffer();
  if (mime === 'image/png') return image.png({ compressionLevel: 9 }).toBuffer();
  return image.webp({ quality: 82 }).toBuffer();
}

async function saveImageFromDataUrl(dataUrl, subfolder) {
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
  if (!matchesSignature(buffer, mime)) {
    throw new Error('Содержимое файла не соответствует заявленному типу изображения');
  }

  let outputBuffer;
  try {
    outputBuffer = await recompress(buffer, mime);
  } catch (err) {
    throw new Error('Не удалось обработать изображение — файл повреждён или это не настоящая фотография');
  }

  const dir = path.join(IMAGES_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), outputBuffer);

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

module.exports = { saveImageFromDataUrl, deleteImageByUrl, MAX_BYTES };
