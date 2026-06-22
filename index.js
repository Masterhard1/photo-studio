const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const auth = require('./server/auth');
const store = require('./server/contentStore');
const imageStore = require('./server/imageStore');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(relativePath)));

  if (!filePath.startsWith(PUBLIC_DIR)) {
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
    const body = await readJsonBody(req, 10 * 1024);
    const slot = auth.verifyPassword(body.password || '');
    if (!slot) {
      sendJson(res, 401, { error: 'Неверный пароль' });
      return;
    }
    const token = auth.createSession(slot);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    sendJson(res, 200, { ok: true, slot });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const cookies = auth.parseCookies(req);
    auth.destroySession(cookies.session);
    res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
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
    if (!body.newPassword || body.newPassword.length < 4) {
      sendJson(res, 400, { error: 'Новый пароль должен быть не короче 4 символов' });
      return;
    }
    if (auth.verifyPasswordForSlot(auth.otherSlot(slot), body.newPassword)) {
      sendJson(res, 400, { error: 'Такой пароль уже используется во втором входе — выбери другой' });
      return;
    }
    auth.setPassword(slot, body.newPassword);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/reset-primary-password' && req.method === 'POST') {
    if (auth.getSlot(req) !== 'backup') {
      sendJson(res, 403, { error: 'Доступно только из резервного входа' });
      return;
    }
    const didReset = auth.resetPrimaryPassword();
    if (!didReset) {
      sendJson(res, 400, { error: 'Сброс невозможен: пароль 1234 совпадает с твоим текущим паролем. Сначала смени свой пароль на другой.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/about' && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024 * 1024);
    let image;
    if (body.imageDataUrl) {
      const current = store.getContent().about.image;
      image = imageStore.saveImageFromDataUrl(body.imageDataUrl, 'about');
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

  if (pathname === '/api/admin/hero' && req.method === 'PUT') {
    const body = await readJsonBody(req, 1024);
    if (!body.image) {
      sendJson(res, 400, { error: 'Не указано изображение' });
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

  if (pathname === '/api/admin/portfolio' && req.method === 'POST') {
    const body = await readJsonBody(req, 16 * 1024 * 1024);
    if (!body.imageDataUrl) {
      sendJson(res, 400, { error: 'Не передано изображение' });
      return;
    }
    const image = imageStore.saveImageFromDataUrl(body.imageDataUrl, 'portfolio');
    const item = store.addPortfolioItem({ image, alt: body.alt || '' });
    sendJson(res, 201, item);
    return;
  }

  const portfolioMatch = pathname.match(/^\/api\/admin\/portfolio\/([a-zA-Z0-9]+)$/);
  if (portfolioMatch && req.method === 'PUT') {
    const body = await readJsonBody(req, 16 * 1024 * 1024);
    let image;
    if (body.imageDataUrl) {
      image = imageStore.saveImageFromDataUrl(body.imageDataUrl, 'portfolio');
    }
    const updated = store.updatePortfolioItem(portfolioMatch[1], { image, alt: body.alt });
    if (!updated) {
      sendJson(res, 404, { error: 'Фото не найдено' });
      return;
    }
    sendJson(res, 200, updated);
    return;
  }
  if (portfolioMatch && req.method === 'DELETE') {
    const removed = store.deletePortfolioItem(portfolioMatch[1]);
    if (!removed) {
      sendJson(res, 404, { error: 'Фото не найдено' });
      return;
    }
    imageStore.deleteImageByUrl(removed.image);
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

  sendJson(res, 404, { error: 'Не найдено' });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      sendJson(res, 400, { error: err.message || 'Ошибка запроса' });
    });
    return;
  }

  serveStaticFile(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
