const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REVIEWS_PATH = path.join(__dirname, '..', 'data', 'reviews.json');
const MAX_PER_IP_PER_DAY = 5; // blocks a single visitor from flooding the section, no need for a captcha
const LIMIT_PRUNE_DAYS = 2;   // only today (and a one-day cushion for timezone edges) is ever checked

let cache = null;

function genId() {
  return crypto.randomBytes(5).toString('hex');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(REVIEWS_PATH, 'utf8'));
    } catch {
      cache = { reviews: [], hideSection: false };
    }
    if (!Array.isArray(cache.reviews)) cache.reviews = [];
    if (typeof cache.hideSection !== 'boolean') cache.hideSection = false;
    if (!cache.limits || typeof cache.limits !== 'object') cache.limits = {};
    if (typeof cache.ipSalt !== 'string' || cache.ipSalt.length < 32) {
      cache.ipSalt = crypto.randomBytes(32).toString('hex');
      save(); // write immediately — salt must survive a restart
    }
  }
  return cache;
}

function save() {
  const tmpPath = `${REVIEWS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, REVIEWS_PATH);
}

function pruneLimits() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LIMIT_PRUNE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const day of Object.keys(cache.limits)) {
    if (day < cutoffStr) delete cache.limits[day];
  }
}

// Hashed with a per-installation salt so the stored value can't be reversed to the real IP —
// keeps this out of "personal data" territory the same way statsStore does.
function hashIp(ip) {
  return crypto.createHash('sha256').update(cache.ipSalt + (ip || '')).digest('hex').slice(0, 16);
}

function isOverLimit(ip) {
  const data = load();
  const day = today();
  const ipHash = hashIp(ip);
  const count = (data.limits[day] && data.limits[day][ipHash]) || 0;
  return count >= MAX_PER_IP_PER_DAY;
}

function consumeLimit(ip) {
  const data = load();
  const day = today();
  const ipHash = hashIp(ip);
  if (!data.limits[day]) data.limits[day] = {};
  data.limits[day][ipHash] = (data.limits[day][ipHash] || 0) + 1;
  pruneLimits();
}

function addReview({ name, comment, rating, ip }) {
  if (isOverLimit(ip)) {
    throw new Error('Слишком много отзывов с вашего адреса за сегодня. Попробуйте завтра.');
  }
  const data = load();
  const review = {
    id: genId(),
    name: name.trim().slice(0, 60),
    comment: (comment || '').trim().slice(0, 500),
    rating,
    createdAt: new Date().toISOString(),
    hidden: false,
  };
  data.reviews.unshift(review);
  consumeLimit(ip);
  save();
  return review;
}

function listPublic() {
  const data = load();
  if (data.hideSection) return { reviews: [], hideSection: true };
  const reviews = data.reviews
    .filter((r) => !r.hidden)
    .map(({ id, name, comment, rating, createdAt }) => ({ id, name, comment, rating, createdAt }));
  return { reviews, hideSection: false };
}

function listAll() {
  const data = load();
  return { reviews: data.reviews, hideSection: data.hideSection };
}

function setHidden(id, hidden) {
  const data = load();
  const review = data.reviews.find((r) => r.id === id);
  if (!review) return null;
  review.hidden = !!hidden;
  save();
  return review;
}

function deleteReview(id) {
  const data = load();
  const index = data.reviews.findIndex((r) => r.id === id);
  if (index === -1) return false;
  data.reviews.splice(index, 1);
  save();
  return true;
}

function setHideSection(value) {
  const data = load();
  data.hideSection = !!value;
  save();
}

module.exports = {
  addReview,
  listPublic,
  listAll,
  setHidden,
  deleteReview,
  setHideSection,
};
