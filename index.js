const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

require('./server/env').loadEnvFile();

const auth = require('./server/auth');
const store = require('./server/contentStore');
const imageStore = require('./server/imageStore');
const statsStore = require('./server/statsStore');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// base64 inflates raw bytes by 4/3; add headroom for the data: URL prefix and surrounding JSON fields
const MAX_IMAGE_BODY_BYTES = Math.ceil((imageStore.MAX_BYTES * 4) / 3) + 64 * 1024;

const LOGIN_RATE_LIMIT = { maxAttempts: 10, windowMs: 10 * 60 * 1000 };
const loginAttempts = new Map();

// Without this, an entry sits in memory forever for every IP that ever attempted a login.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_LIMIT.windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_RATE_LIMIT.maxAttempts;
}

function isHttpsRequest(req) {
  return Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, token) {
  const secure = isHttpsRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = isHttpsRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

function setSecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self'",
      "frame-src https://yandex.ru",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function requireAuth(req, res) {
  if (!auth.isAuthed(req)) {
    sendJson(res, 401, { error: 'Не авторизовано' });
    return false;
  }
  return true;
}

function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  if (relativePath === '/admin') relativePath = '/admin.html';

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));
  const relativeToPublic = path.relative(PUBLIC_DIR, filePath);

  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, '404.html'), (notFoundErr, notFoundData) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(notFoundErr ? '<h1>404 — страница не найдена</h1>' : notFoundData);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  // Public
  if (pathname === '/api/content' && req.method === 'GET') {
    sendJson(res, 200, store.getContent());
    return;
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    sendJson(res, 200, { authed: auth.isAuthed(req), slot: auth.getSlot(req) });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (!checkLoginRateLimit(ip)) {
      sendJson(res, 429, { error: 'Слишком много попыток входа. Попробуй снова через несколько минут.' });
      return;
    }
    const body = await readJsonBody(req, 10 * 1024);
    const slot = auth.verifyPassword(body.password || '');
    if (!slot) {
      sendJson(res, 401, { error: 'Неверный пароль' });
      return;
    }
    const token = auth.createSession(slot);
    setSessionCookie(req, res, token);
    sendJson(res, 200, { ok: true, slot });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const cookies = auth.parseCookies(req);
    auth.destroySession(cookies.session);
    clearSessionCookie(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Everything below requires auth
  if (!requireAuth(req, res)) return;

  if (pathname === '/api/admin/password' && req.method === 'PUT') {
    const body = await readJsonBody(req, 10 * 1024);
    const slot = auth.getSlot(req);
    if (!auth.verifyPasswordForSlot(slot, body.currentPassword || '')) {
      sendJson(res, 401, { error: 'Текущий пароль неверен' });
      return;
    }
    const strength = auth.validatePasswordStrength(body.newPassword || '');
    if (!strength.ok) {
      sendJson(res, 400, { error: strength.error });
      return;
    }
    if (auth.verifyPasswordForSlot(auth.otherSlot(slot), body.newPassword)) {
      sendJson(res, 400, { error: 'Такой пароль уже используется во втором входе — выбери другой' });
      return;
    }
    auth.setPassword(slot, body.newPassword);
    auth.destroySessionsForSlot(slot);
    clearSessionCookie(req, res);
    sendJson(res, 200, { ok: true, reauth: true });
    return;
  }

  if (pathname === '/api/admin/reset-primary-password' && req.method === 'POST') {
    if (auth.getSlot(req) !== 'backup') {
      sendJson(res, 403, { error: 'Доступно только из резервного входа' });
      return;
    }
    const newPassword = auth.resetPrimaryPassword();
    sendJson(res, 200, { ok: true, newPassword });
    return;
  }

  if (pathname === '/api/admin/about' && req.method === 'PUT') {
    const body = await readJsonBody(req, MAX_IMAGE_BODY_BYTES);
    let image;
    if (body.imageDataUrl) {
      const current = store.getContent().about.image;
      image = await imageStore.saveImageFromDataUrl(body.imageDataUrl, 'about');
      imageStore.deleteImageByUrl(current);
    }
    const about = store.updateAbout({ text: body.text, image });
    sendJson(res, 200, about);
    return;
  }

  if (pathname === '/api/admin/services-note' && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024);
    const note = store.updateServicesNote(body.text || '');
    sendJson(res, 200, { text: note });
    return;
  }

  if (pathname === '/api/admin/footer-legal' && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024);
    const text = store.updateFooterLegal(body.text || '');
    sendJson(res, 200, { text });
    return;
  }

  if (pathname === '/api/admin/hero' && req.method === 'PUT') {
    const body = await readJsonBody(req, 1024);
    if (!body.image) {
      sendJson(res, 400, { error: 'Не указано изображение' });
      return;
    }
    const existsInPortfolio = store.getContent().portfolio.some((p) => p.image === body.image);
    if (!existsInPortfolio) {
      sendJson(res, 400, { error: 'Такого изображения нет в портфолио' });
      return;
    }
    const hero = store.setHeroImage(body.image);
    sendJson(res, 200, hero);
    return;
  }

  if (pathname === '/api/admin/services' && req.method === 'POST') {
    const body = await readJsonBody(req, 16 * 1024);
    if (!body.title || !body.price) {
      sendJson(res, 400, { error: 'Укажите название и цену услуги' });
      return;
    }
    const service = store.addService({ title: body.title, price: body.price, description: body.description || '' });
    sendJson(res, 201, service);
    return;
  }

  const serviceMatch = pathname.match(/^\/api\/admin\/services\/([a-zA-Z0-9]+)$/);
  if (serviceMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024);
    const updated = store.updateService(serviceMatch[1], body);
    if (!updated) {
      sendJson(res, 404, { error: 'Услуга не найдена' });
      return;
    }
    sendJson(res, 200, updated);
    return;
  }
  if (serviceMatch && req.method === 'DELETE') {
    const ok = store.deleteService(serviceMatch[1]);
    if (!ok) {
      sendJson(res, 404, { error: 'Услуга не найдена' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const serviceMoveMatch = pathname.match(/^\/api\/admin\/services\/([a-zA-Z0-9]+)\/move$/);
  if (serviceMoveMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 1024);
    const ok = store.moveService(serviceMoveMatch[1], body.direction);
    if (!ok) {
      sendJson(res, 400, { error: 'Невозможно переместить' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/portfolio' && req.method === 'POST') {
    const body = await readJsonBody(req, MAX_IMAGE_BODY_BYTES);
    if (!body.imageDataUrl) {
      sendJson(res, 400, { error: 'Не передано изображение' });
      return;
    }
    const image = await imageStore.saveImageFromDataUrl(body.imageDataUrl, 'portfolio');
    const item = store.addPortfolioItem({ image, alt: body.alt || '' });
    sendJson(res, 201, item);
    return;
  }

  const portfolioMatch = pathname.match(/^\/api\/admin\/portfolio\/([a-zA-Z0-9]+)$/);
  if (portfolioMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, MAX_IMAGE_BODY_BYTES);
    let image;
    let previousImage;
    if (body.imageDataUrl) {
      const existing = store.getContent().portfolio.find((p) => p.id === portfolioMatch[1]);
      previousImage = existing ? existing.image : undefined;
      image = await imageStore.saveImageFromDataUrl(body.imageDataUrl, 'portfolio');
    }
    const wasHero = image && previousImage && store.getContent().hero.image === previousImage;
    const updated = store.updatePortfolioItem(portfolioMatch[1], { image, alt: body.alt });
    if (!updated) {
      sendJson(res, 404, { error: 'Фото не найдено' });
      return;
    }
    if (previousImage && previousImage !== updated.image) {
      imageStore.deleteImageByUrl(previousImage);
      if (wasHero) store.setHeroImage(updated.image);
    }
    sendJson(res, 200, updated);
    return;
  }
  if (portfolioMatch && req.method === 'DELETE') {
    const content = store.getContent();
    const wasHero = content.hero.image === (content.portfolio.find((p) => p.id === portfolioMatch[1]) || {}).image;
    const removed = store.deletePortfolioItem(portfolioMatch[1]);
    if (!removed) {
      sendJson(res, 404, { error: 'Фото не найдено' });
      return;
    }
    imageStore.deleteImageByUrl(removed.image);
    if (wasHero) {
      const remaining = store.getContent().portfolio;
      store.setHeroImage(remaining.length > 0 ? remaining[0].image : '');
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const portfolioMoveMatch = pathname.match(/^\/api\/admin\/portfolio\/([a-zA-Z0-9]+)\/move$/);
  if (portfolioMoveMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 1024);
    const ok = store.movePortfolioItem(portfolioMoveMatch[1], body.direction);
    if (!ok) {
      sendJson(res, 400, { error: 'Невозможно переместить' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/contacts' && req.method === 'POST') {
    const body = await readJsonBody(req, 16 * 1024);
    if (!body.label || !body.value) {
      sendJson(res, 400, { error: 'Укажите название и значение' });
      return;
    }
    const contact = store.addContact({ label: body.label, value: body.value });
    sendJson(res, 201, contact);
    return;
  }

  const contactMatch = pathname.match(/^\/api\/admin\/contacts\/([a-zA-Z0-9]+)$/);
  if (contactMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024);
    const updated = store.updateContact(contactMatch[1], body);
    if (!updated) {
      sendJson(res, 404, { error: 'Контакт не найден' });
      return;
    }
    sendJson(res, 200, updated);
    return;
  }
  if (contactMatch && req.method === 'DELETE') {
    const ok = store.deleteContact(contactMatch[1]);
    if (!ok) {
      sendJson(res, 404, { error: 'Контакт не найден' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const contactMoveMatch = pathname.match(/^\/api\/admin\/contacts\/([a-zA-Z0-9]+)\/move$/);
  if (contactMoveMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 1024);
    const ok = store.moveContact(contactMoveMatch[1], body.direction);
    if (!ok) {
      sendJson(res, 400, { error: 'Невозможно переместить' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    sendJson(res, 200, statsStore.getStats());
    return;
  }

  sendJson(res, 404, { error: 'Не найдено' });
}

try {
  auth.ensureInitialized();
} catch (err) {
  console.error(`\nСервер не запущен: ${err.message}\n`);
  process.exit(1);
}

function requestListener(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  setSecurityHeaders(req, res);

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error('[API error]', req.method, pathname, err);
      sendJson(res, 400, { error: err.message || 'Ошибка запроса' });
    });
    return;
  }

  if (pathname === '/' && req.method === 'GET' && !auth.isAuthed(req)) {
    try { statsStore.recordHit(getClientIp(req)); } catch (e) { /* never block page load */ }
  }

  serveStaticFile(req, res, pathname);
}

const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;

if (sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const httpsPort = process.env.HTTPS_PORT || 443;
  const httpsServer = https.createServer(
    { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) },
    requestListener
  );
  httpsServer.listen(httpsPort, () => {
    console.log(`HTTPS server is running on port ${httpsPort}`);
  });

  // Plain HTTP server only redirects to HTTPS — it never serves content directly.
  const redirectServer = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
  });
  redirectServer.listen(PORT, () => {
    console.log(`HTTP server is running on port ${PORT} (redirecting to HTTPS)`);
  });
} else {
  const server = http.createServer(requestListener);
  server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}
