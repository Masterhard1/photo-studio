document.getElementById('year').textContent = new Date().getFullYear();

function renderServices(services) {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = '';
  services.forEach((service) => {
    const card = document.createElement('div');
    card.className = 'service-card';

    const title = document.createElement('h3');
    title.textContent = service.title;

    const price = document.createElement('p');
    price.className = 'service-card__price';
    price.textContent = service.price;

    const desc = document.createElement('p');
    desc.className = 'service-card__desc';
    desc.textContent = service.description;

    card.addEventListener('click', () => card.classList.toggle('is-zoomed'));

    card.append(title, price, desc);
    grid.appendChild(card);
  });
}

function renderPortfolio(portfolio) {
  const grid = document.getElementById('portfolio-grid');
  grid.innerHTML = '';
  portfolio.forEach((item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'portfolio__item';

    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.alt || '';
    img.loading = 'lazy';

    wrapper.appendChild(img);
    grid.appendChild(wrapper);
  });
}

function setupLightbox() {
  const galleryImages = Array.from(document.querySelectorAll('.portfolio__item img'));
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  let currentIndex = 0;

  function showImage(index) {
    currentIndex = (index + galleryImages.length) % galleryImages.length;
    const target = galleryImages[currentIndex];
    lightboxImg.src = target.src;
    lightboxImg.alt = target.alt;
  }

  function openLightbox(index) {
    showImage(index);
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  galleryImages.forEach((img, index) => {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', () => openLightbox(index));
  });

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-next').addEventListener('click', () => showImage(currentIndex + 1));
  document.getElementById('lightbox-prev').addEventListener('click', () => showImage(currentIndex - 1));

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') showImage(currentIndex + 1);
    if (e.key === 'ArrowLeft') showImage(currentIndex - 1);
  });

  let touchStartX = null;
  lightbox.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  });
  lightbox.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(deltaX) < 40) return;
    if (deltaX < 0) showImage(currentIndex + 1);
    else showImage(currentIndex - 1);
  });
}

function renderContacts(contacts) {
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';
  contacts.forEach((contact) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${contact.label}: `;
    p.appendChild(strong);

    if (/^https?:\/\//i.test(contact.value)) {
      const link = document.createElement('a');
      link.href = contact.value;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = contact.value.replace(/^https?:\/\//i, '');
      p.appendChild(link);
    } else if (/^\+?[\d\s()-]{6,}$/.test(contact.value)) {
      const link = document.createElement('a');
      link.href = `tel:${contact.value.replace(/[^\d+]/g, '')}`;
      link.textContent = contact.value;
      p.appendChild(link);
    } else {
      p.appendChild(document.createTextNode(contact.value));
    }
    list.appendChild(p);
  });
}

function syncPhoneLinks(contacts) {
  const phoneContact = contacts.find((c) => /телефон/i.test(c.label));
  if (!phoneContact) return;
  const telHref = `tel:${phoneContact.value.replace(/[^\d+]/g, '')}`;
  const headerPhone = document.getElementById('header-phone');
  headerPhone.href = telHref;
  headerPhone.textContent = phoneContact.value;
}

fetch('/api/content')
  .then((res) => res.json())
  .then((content) => {
    document.getElementById('hero-img').src = content.hero.image;
    const aboutImg = document.getElementById('about-img');
    aboutImg.src = content.about.image;
    aboutImg.addEventListener('click', () => aboutImg.classList.toggle('is-zoomed'));
    document.getElementById('about-text').textContent = content.about.text;
    document.getElementById('services-note').textContent = content.servicesNote;
    renderServices(content.services);
    renderPortfolio(content.portfolio);
    renderContacts(content.contacts);
    syncPhoneLinks(content.contacts);
    setupLightbox();
  })
  .catch((err) => {
    console.error('Не удалось загрузить контент сайта', err);
  });
