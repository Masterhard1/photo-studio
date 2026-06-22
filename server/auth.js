const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATHS = {
  primary: path.join(__dirname, '..', 'data', 'admin-config.json'),
  backup: path.join(__dirname, '..', 'data', 'admin-config-backup.json'),
};
const DEFAULT_PASSWORDS = {
  primary: '1234',
  backup: '12345',
};
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function loadConfig(slot) {
  const configPath = CONFIG_PATHS[slot];
  if (!fs.existsSync(configPath)) {
    setPassword(slot, DEFAULT_PASSWORDS[slot]);
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

function resetPrimaryPassword() {
  if (verifyPasswordForSlot('backup', DEFAULT_PASSWORDS.primary)) {
    return false;
  }
  setPassword('primary', DEFAULT_PASSWORDS.primary);
  return true;
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
  verifyPassword,
  verifyPasswordForSlot,
  setPassword,
  resetPrimaryPassword,
  otherSlot,
  createSession,
  destroySession,
  parseCookies,
  isAuthed,
  getSlot,
};
