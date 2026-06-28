const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATS_PATH = path.join(__dirname, '..', 'data', 'stats.json');
const PRUNE_DAYS = 90;

let cache = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    } catch {
      cache = { totalViews: 0, days: {} };
    }
    if (typeof cache.totalViews !== 'number') cache.totalViews = 0;
    if (!cache.days || typeof cache.days !== 'object') cache.days = {};
    if (typeof cache.ipSalt !== 'string' || cache.ipSalt.length < 32) {
      cache.ipSalt = crypto.randomBytes(32).toString('hex');
      save();
    }
  }
  return cache;
}

function save() {
  const tmpPath = `${STATS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATS_PATH);
}

function prune() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const day of Object.keys(cache.days)) {
    if (day < cutoffStr) delete cache.days[day];
  }
}

function recordHit(ip) {
  const data = load();
  const day = today();
  data.totalViews += 1;
  if (!data.days[day]) data.days[day] = { views: 0, uniq: 0, ips: [] };
  data.days[day].views += 1;
  const ipHash = crypto.createHash('sha256').update(data.ipSalt + (ip || '')).digest('hex').slice(0, 16);
  if (!data.days[day].ips.includes(ipHash)) {
    data.days[day].uniq += 1;
    data.days[day].ips.push(ipHash);
  }
  prune();
  save();
}

function getStats() {
  const data = load();
  const days = {};
  for (const [day, val] of Object.entries(data.days)) {
    days[day] = { views: val.views, uniq: val.uniq };
  }
  return { totalViews: data.totalViews, days };
}

module.exports = { recordHit, getStats };
