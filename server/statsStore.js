const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATS_PATH = path.join(__dirname, '..', 'data', 'stats.json');
const PRUNE_DAYS = 90;
const MAX_IPS_PER_DAY = 500;   // caps ips[] growth; views keep counting after this
const FLUSH_INTERVAL_MS = 30_000; // write to disk at most once per 30 s

let cache = null;
let dirty = false;
let flushTimer = null;

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
      save(); // write immediately — salt must survive a restart
    }
  }
  return cache;
}

function save() {
  const tmpPath = `${STATS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATS_PATH);
}

function flushSync() {
  if (dirty && cache) {
    dirty = false;
    try { save(); } catch (e) { console.error('[statsStore] flush error:', e.message); }
  }
}

// Schedule a lazy write; actual disk I/O happens at most once per FLUSH_INTERVAL_MS
function scheduleSave() {
  dirty = true;
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      if (dirty) {
        dirty = false;
        try { save(); } catch (e) { console.error('[statsStore] flush error:', e.message); }
      }
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref(); // don't keep process alive just for stats
  }
}

// Flush on clean shutdown so the last <30 s of hits aren't lost
process.on('exit', flushSync);
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('SIGINT',  () => { flushSync(); process.exit(0); });

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

  // Only track unique IPs up to the daily cap — prevents unbounded array growth under DoS
  if (data.days[day].ips.length < MAX_IPS_PER_DAY) {
    const ipHash = crypto.createHash('sha256').update(data.ipSalt + (ip || '')).digest('hex').slice(0, 16);
    if (!data.days[day].ips.includes(ipHash)) {
      data.days[day].uniq += 1;
      data.days[day].ips.push(ipHash);
    }
  }

  prune();
  scheduleSave(); // deferred write — no disk I/O on every request
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
