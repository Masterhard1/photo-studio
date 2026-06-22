const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATHS = {
  primary: path.join(__dirname, '..', 'data', 'admin-config.json'),
  backup: path.join(__dirname, '..', 'data', 'admin-config-backup.json'),
};
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;

const WEAK_PASSWORDS = new Set([
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwertyuiop', 'qwerty123', 'password', 'password1', 'iloveyou',
  'пароль', 'пароль123', 'admin', 'admin123', '11111111', '00000000',
]);

const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function loadConfig(slot) {
  const configPath = CONFIG_PATHS[slot];
  if (!fs.existsSync(configPath)) {
    throw new Error(`Конфигурация пароля для "${slot}" отсутствует — сервер не был корректно инициализирован`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function setPassword(slot, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  fs.writeFileSync(CONFIG_PATHS[slot], JSON.stringify({ salt, hash }, null, 2), 'utf8');
}

function verifyPasswordForSlot(slot, password) {
  const config = loadConfig(slot);
  const hash = hashPassword(password, config.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(config.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPassword(password) {
  if (verifyPasswordForSlot('primary', password)) return 'primary';
  if (verifyPasswordForSlot('backup', password)) return 'backup';
  return null;
}

function otherSlot(slot) {
  return slot === 'primary' ? 'backup' : 'primary';
}

function normalizeDigits(value) {
  return (value || '').replace(/\D/g, '');
}

function isAllSameChar(value) {
  return /^(.)\1+$/.test(value);
}

function isSequential(value) {
  if (value.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) !== value.charCodeAt(i - 1) + 1) ascending = false;
    if (value.charCodeAt(i) !== value.charCodeAt(i - 1) - 1) descending = false;
  }
  return ascending || descending;
}

function getStudioPhoneDigits() {
  try {
    // Lazy require avoids a hard circular dependency at module load time.
    const content = require('./contentStore').getContent();
    const phoneContact = (content.contacts || []).find((c) => /телефон/i.test(c.label));
    return phoneContact ? normalizeDigits(phoneContact.value) : '';
  } catch (err) {
    return '';
  }
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` };
  }
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    return { ok: false, error: 'Этот пароль слишком простой и легко угадывается — выбери другой' };
  }
  if (isAllSameChar(password)) {
    return { ok: false, error: 'Пароль не должен состоять из одного повторяющегося символа' };
  }
  if (isSequential(lower)) {
    return { ok: false, error: 'Пароль не должен быть простой последовательностью символов' };
  }
  const passwordDigits = normalizeDigits(password);
  const phoneDigits = getStudioPhoneDigits();
  if (phoneDigits && passwordDigits && passwordDigits.includes(phoneDigits)) {
    return { ok: false, error: 'Пароль не должен совпадать с номером телефона студии' };
  }
  return { ok: true };
}

function generateStrongPassword(length = 14) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%&*';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += charset[crypto.randomInt(charset.length)];
  }
  return pwd;
}

function ensureInitialized() {
  for (const slot of Object.keys(CONFIG_PATHS)) {
    if (fs.existsSync(CONFIG_PATHS[slot])) continue;
    const envKey = `ADMIN_PASSWORD_${slot.toUpperCase()}`;
    const password = process.env[envKey];
    if (!password) {
      throw new Error(
        `Не задан пароль для первого запуска. Создай файл .env в корне проекта (см. .env.example) и укажи в нём ${envKey}.`
      );
    }
    const check = validatePasswordStrength(password);
    if (!check.ok) {
      throw new Error(`Пароль в ${envKey} не подходит: ${check.error}`);
    }
    setPassword(slot, password);
  }
}

function resetPrimaryPassword() {
  let candidate = generateStrongPassword();
  let attempts = 0;
  while (verifyPasswordForSlot('backup', candidate) && attempts < 5) {
    candidate = generateStrongPassword();
    attempts++;
  }
  setPassword('primary', candidate);
  destroySessionsForSlot('primary');
  return candidate;
}

function createSession(slot) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { slot, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token || !sessions.has(token)) return null;
  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

function destroySessionsForSlot(slot) {
  for (const [token, session] of sessions) {
    if (session.slot === slot) sessions.delete(token);
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return !!getSession(cookies.session);
}

function getSlot(req) {
  const cookies = parseCookies(req);
  const session = getSession(cookies.session);
  return session ? session.slot : null;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  ensureInitialized,
  validatePasswordStrength,
  verifyPassword,
  verifyPasswordForSlot,
  setPassword,
  resetPrimaryPassword,
  otherSlot,
  createSession,
  destroySession,
  destroySessionsForSlot,
  parseCookies,
  isAuthed,
  getSlot,
};
