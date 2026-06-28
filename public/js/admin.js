const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createMoveRow(index, total, onMove) {
  const row = document.createElement('div');
  row.className = 'admin-move-row';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'admin-btn admin-btn--outline';
  upBtn.textContent = '↑ Выше';
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', () => onMove('up'));

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'admin-btn admin-btn--outline';
  downBtn.textContent = '↓ Ниже';
  downBtn.disabled = index === total - 1;
  downBtn.addEventListener('click', () => onMove('down'));

  row.append(upBtn, downBtn);
  return row;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('admin-autosize')) {
    autosize(e.target);
  }
});

function getPasswordStrength(password) {
  if (!password) return { level: '', label: '' };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/\d/.test(password)) score++;
  if (/[A-ZА-Я]/.test(password) && /[a-zа-я]/.test(password)) score++;
  if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score++;

  if (score <= 2) return { level: 'is-weak', label: 'Слабый пароль' };
  if (score <= 3) return { level: 'is-medium', label: 'Средний пароль' };
  return { level: 'is-strong', label: 'Надёжный пароль' };
}

document.getElementById('new-password').addEventListener('input', (e) => {
  const bar = document.getElementById('strength-meter-bar');
  const label = document.getElementById('strength-meter-label');
  const { level, label: text } = getPasswordStrength(e.target.value);
  bar.className = 'strength-meter__bar' + (level ? ` ${level}` : '');
  label.textContent = text;
});

function setStatus(el, message, isError) {
  el.textContent = message;
  el.classList.toggle('is-success', !isError && !!message);
  el.classList.toggle('is-error', !!isError);
  if (message) {
    setTimeout(() => { el.textContent = ''; el.classList.remove('is-success', 'is-error'); }, 3500);
  }
}

async function loadStats() {
  const block = document.getElementById('stats-block');
  try {
    const stats = await api('/api/admin/stats');
    const days = Object.entries(stats.days).sort(([a], [b]) => b.localeCompare(a));
    const last7 = days.slice(0, 7);
    const viewsLast7 = last7.reduce((sum, [, d]) => sum + d.views, 0);

    let rows = '';
    for (const [day, d] of last7) {
      const [y, m, dd] = day.split('-');
      rows += `<tr><td>${dd}.${m}.${y}</td><td>${d.views}</td><td>${d.uniq}</td></tr>`;
    }

    block.innerHTML = `
      <div class="stats-totals">
        <div class="stats-total-item"><span class="stats-big">${stats.totalViews}</span><span class="stats-label">всего просмотров</span></div>
        <div class="stats-total-item"><span class="stats-big">${viewsLast7}</span><span class="stats-label">за последние 7 дней</span></div>
      </div>
      ${rows ? `<table class="stats-table">
        <thead><tr><th>Дата</th><th>Просмотры</th><th>Уникальных</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p class="admin-hint">Пока нет данных — посетите главную страницу, чтобы появилась первая запись.</p>'}
    `;
  } catch {
    block.innerHTML = '<p class="admin-hint">Не удалось загрузить статистику.</p>';
  }
}

document.getElementById('stats-reset-btn').addEventListener('click', async () => {
  if (!confirm('Сбросить всю статистику посещений? Это действие нельзя отменить.')) return;
  const status = document.getElementById('stats-reset-status');
  try {
    await api('/api/admin/stats', { method: 'DELETE' });
    setStatus(status, 'Статистика сброшена', false);
    loadStats();
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

function showDashboard(slot) {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  document.getElementById('backup-reset-block').hidden = slot !== 'backup';
  loadContent();
  loadStats();
}

function showLogin() {
  loginScreen.hidden = false;
  dashboard.hidden = true;
}

let currentContent = null;

async function loadContent() {
  currentContent = await api('/api/content');
  document.getElementById('about-text').value = currentContent.about.text;
  document.getElementById('about-preview').src = currentContent.about.image;
  const servicesNoteEl = document.getElementById('services-note-text');
  servicesNoteEl.value = currentContent.servicesNote || '';
  autosize(servicesNoteEl);
  const footerLegalEl = document.getElementById('footer-legal-text');
  footerLegalEl.value = currentContent.footerLegal || '';
  autosize(footerLegalEl);
  renderServices();
  renderPortfolio();
  renderContacts();
}

function renderServices() {
  const list = document.getElementById('services-list');
  list.innerHTML = '';
  currentContent.services.forEach((service, index) => {
    const row = document.createElement('div');
    row.className = 'admin-list-item';

    const titleInput = document.createElement('input');
    titleInput.value = service.title;

    const priceInput = document.createElement('input');
    priceInput.value = service.price;

    const descInput = document.createElement('textarea');
    descInput.rows = 2;
    descInput.className = 'admin-autosize';
    descInput.value = service.description;

    const actions = document.createElement('div');
    actions.className = 'admin-list-item__actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'admin-btn';
    saveBtn.textContent = 'Сохранить';
    saveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/services/${service.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: titleInput.value, price: priceInput.value, description: descInput.value }),
        });
        Object.assign(service, { title: titleInput.value, price: priceInput.value, description: descInput.value });
      } catch (err) {
        alert(err.message);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'admin-btn admin-btn--danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Удалить услугу «${service.title}»?`)) return;
      try {
        await api(`/api/admin/services/${service.id}`, { method: 'DELETE' });
        currentContent.services = currentContent.services.filter((s) => s.id !== service.id);
        renderServices();
      } catch (err) {
        alert(err.message);
      }
    });

    const moveRow = createMoveRow(index, currentContent.services.length, async (direction) => {
      try {
        await api(`/api/admin/services/${service.id}/move`, { method: 'PUT', body: JSON.stringify({ direction }) });
        await loadContent();
      } catch (err) {
        alert(err.message);
      }
    });

    actions.append(moveRow, saveBtn, deleteBtn);
    row.append(titleInput, priceInput, descInput, actions);
    list.appendChild(row);
    autosize(descInput);
  });
}

function renderPortfolio() {
  const grid = document.getElementById('portfolio-list');
  grid.innerHTML = '';
  currentContent.portfolio.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'admin-photo-card';
    const isHero = currentContent.hero.image === item.image;
    if (isHero) card.classList.add('is-hero');

    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.alt || '';

    const altInput = document.createElement('input');
    altInput.value = item.alt || '';
    altInput.placeholder = 'Описание фото';

    const heroTag = document.createElement('div');
    heroTag.className = 'admin-photo-card__hero-tag';
    heroTag.textContent = isHero ? '★ Главное фото' : '';

    const actions = document.createElement('div');
    actions.className = 'admin-photo-card__actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'admin-btn';
    saveBtn.textContent = 'Сохранить';
    saveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/portfolio/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ alt: altInput.value }),
        });
        item.alt = altInput.value;
      } catch (err) {
        alert(err.message);
      }
    });

    const heroBtn = document.createElement('button');
    heroBtn.className = 'admin-btn admin-btn--outline';
    heroBtn.textContent = 'Сделать главным';
    heroBtn.addEventListener('click', async () => {
      try {
        const hero = await api('/api/admin/hero', { method: 'PUT', body: JSON.stringify({ image: item.image }) });
        currentContent.hero = hero;
        renderPortfolio();
      } catch (err) {
        alert(err.message);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'admin-btn admin-btn--danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Удалить это фото из портфолио?')) return;
      try {
        await api(`/api/admin/portfolio/${item.id}`, { method: 'DELETE' });
        currentContent.portfolio = currentContent.portfolio.filter((p) => p.id !== item.id);
        renderPortfolio();
      } catch (err) {
        alert(err.message);
      }
    });

    const moveRow = createMoveRow(index, currentContent.portfolio.length, async (direction) => {
      try {
        await api(`/api/admin/portfolio/${item.id}/move`, { method: 'PUT', body: JSON.stringify({ direction }) });
        await loadContent();
      } catch (err) {
        alert(err.message);
      }
    });

    actions.append(moveRow, saveBtn, heroBtn, deleteBtn);
    card.append(img, altInput, heroTag, actions);
    grid.appendChild(card);
  });
}

function renderContacts() {
  const list = document.getElementById('contacts-list-admin');
  list.innerHTML = '';
  currentContent.contacts.forEach((contact, index) => {
    const row = document.createElement('div');
    row.className = 'admin-list-item admin-list-item--contact';

    const labelInput = document.createElement('input');
    labelInput.value = contact.label;

    const valueInput = document.createElement('input');
    valueInput.value = contact.value;

    const actions = document.createElement('div');
    actions.className = 'admin-list-item__actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'admin-btn';
    saveBtn.textContent = 'Сохранить';
    saveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/contacts/${contact.id}`, {
          method: 'PUT',
          body: JSON.stringify({ label: labelInput.value, value: valueInput.value }),
        });
        Object.assign(contact, { label: labelInput.value, value: valueInput.value });
      } catch (err) {
        alert(err.message);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'admin-btn admin-btn--danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Удалить строку «${contact.label}»?`)) return;
      try {
        await api(`/api/admin/contacts/${contact.id}`, { method: 'DELETE' });
        currentContent.contacts = currentContent.contacts.filter((c) => c.id !== contact.id);
        renderContacts();
      } catch (err) {
        alert(err.message);
      }
    });

    const moveRow = createMoveRow(index, currentContent.contacts.length, async (direction) => {
      try {
        await api(`/api/admin/contacts/${contact.id}/move`, { method: 'PUT', body: JSON.stringify({ direction }) });
        await loadContent();
      } catch (err) {
        alert(err.message);
      }
    });

    actions.append(moveRow, saveBtn, deleteBtn);
    row.append(labelInput, valueInput, actions);
    list.appendChild(row);
  });
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    errorEl.textContent = '';
    showDashboard(result.slot);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const status = document.getElementById('password-status');
  try {
    await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    e.target.reset();
    document.getElementById('strength-meter-bar').className = 'strength-meter__bar';
    document.getElementById('strength-meter-label').textContent = '';
    alert('Пароль изменён. Сейчас нужно будет войти заново с новым паролем.');
    showLogin();
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('about-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('about-status');
  const text = document.getElementById('about-text').value;
  const fileInput = document.getElementById('about-file');
  try {
    const payload = { text };
    if (fileInput.files[0]) {
      payload.imageDataUrl = await readFileAsDataUrl(fileInput.files[0]);
    }
    const about = await api('/api/admin/about', { method: 'PUT', body: JSON.stringify(payload) });
    document.getElementById('about-preview').src = about.image;
    fileInput.value = '';
    setStatus(status, 'Сохранено', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('services-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('services-note-status');
  const text = document.getElementById('services-note-text').value;
  try {
    await api('/api/admin/services-note', { method: 'PUT', body: JSON.stringify({ text }) });
    currentContent.servicesNote = text;
    setStatus(status, 'Сохранено', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('footer-legal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('footer-legal-status');
  const text = document.getElementById('footer-legal-text').value;
  try {
    await api('/api/admin/footer-legal', { method: 'PUT', body: JSON.stringify({ text }) });
    currentContent.footerLegal = text;
    setStatus(status, 'Сохранено', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('service-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('service-add-status');
  const title = document.getElementById('new-service-title').value;
  const price = document.getElementById('new-service-price').value;
  const description = document.getElementById('new-service-description').value;
  try {
    const service = await api('/api/admin/services', { method: 'POST', body: JSON.stringify({ title, price, description }) });
    currentContent.services.push(service);
    renderServices();
    e.target.reset();
    autosize(document.getElementById('new-service-description'));
    setStatus(status, 'Услуга добавлена', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('portfolio-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('portfolio-add-status');
  const fileInput = document.getElementById('new-portfolio-file');
  const alt = document.getElementById('new-portfolio-alt').value;
  if (!fileInput.files[0]) return;
  try {
    const imageDataUrl = await readFileAsDataUrl(fileInput.files[0]);
    const item = await api('/api/admin/portfolio', { method: 'POST', body: JSON.stringify({ imageDataUrl, alt }) });
    currentContent.portfolio.push(item);
    renderPortfolio();
    e.target.reset();
    setStatus(status, 'Фото добавлено', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

document.getElementById('contact-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('contact-add-status');
  const label = document.getElementById('new-contact-label').value;
  const value = document.getElementById('new-contact-value').value;
  try {
    const contact = await api('/api/admin/contacts', { method: 'POST', body: JSON.stringify({ label, value }) });
    currentContent.contacts.push(contact);
    renderContacts();
    e.target.reset();
    setStatus(status, 'Контакт добавлен', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});

api('/api/session').then((data) => {
  if (data.authed) {
    showDashboard(data.slot);
  } else {
    showLogin();
  }
});

document.getElementById('reset-primary-btn').addEventListener('click', async () => {
  const status = document.getElementById('reset-primary-status');
  const resultEl = document.getElementById('reset-primary-result');
  if (!confirm('Сбросить мамин пароль? Текущий мамин пароль перестанет работать.')) return;
  try {
    const data = await api('/api/admin/reset-primary-password', { method: 'POST' });
    resultEl.hidden = false;
    resultEl.textContent = `Новый пароль мамы: ${data.newPassword} — запиши и передай ей, повторно он не показывается.`;
    setStatus(status, 'Пароль сброшен', false);
  } catch (err) {
    setStatus(status, err.message, true);
  }
});
