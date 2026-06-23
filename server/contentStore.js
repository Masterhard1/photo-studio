const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTENT_PATH = path.join(__dirname, '..', 'data', 'content.json');

let cache = null;

function genId() {
  return crypto.randomBytes(5).toString('hex');
}

const DEFAULTS = {
  hero: { image: '' },
  about: { text: '', image: '' },
  servicesNote: '',
  services: [],
  portfolio: [],
  contacts: [],
  footerLegal: '',
};

function applyDefaults(content) {
  const result = content && typeof content === 'object' ? content : {};
  result.hero = result.hero && typeof result.hero === 'object' ? result.hero : { ...DEFAULTS.hero };
  if (typeof result.hero.image !== 'string') result.hero.image = '';
  result.about = result.about && typeof result.about === 'object' ? result.about : { ...DEFAULTS.about };
  if (typeof result.about.text !== 'string') result.about.text = '';
  if (typeof result.about.image !== 'string') result.about.image = '';
  if (typeof result.servicesNote !== 'string') result.servicesNote = '';
  if (!Array.isArray(result.services)) result.services = [];
  if (!Array.isArray(result.portfolio)) result.portfolio = [];
  if (!Array.isArray(result.contacts)) result.contacts = [];
  if (typeof result.footerLegal !== 'string') result.footerLegal = '';
  return result;
}

function load() {
  if (!cache) {
    const raw = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
    cache = applyDefaults(raw);
  }
  return cache;
}

function save() {
  const tmpPath = `${CONTENT_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, CONTENT_PATH);
}

function getContent() {
  return load();
}

function updateAbout({ text, image }) {
  const content = load();
  if (typeof text === 'string') content.about.text = text;
  if (typeof image === 'string') content.about.image = image;
  save();
  return content.about;
}

function updateServicesNote(text) {
  const content = load();
  content.servicesNote = text;
  save();
  return content.servicesNote;
}

function updateFooterLegal(text) {
  const content = load();
  content.footerLegal = text;
  save();
  return content.footerLegal;
}

function setHeroImage(image) {
  const content = load();
  content.hero.image = image;
  save();
  return content.hero;
}

function addService({ title, price, description }) {
  const content = load();
  const service = { id: genId(), title, price, description };
  content.services.push(service);
  save();
  return service;
}

function updateService(id, { title, price, description }) {
  const content = load();
  const service = content.services.find((s) => s.id === id);
  if (!service) return null;
  if (typeof title === 'string') service.title = title;
  if (typeof price === 'string') service.price = price;
  if (typeof description === 'string') service.description = description;
  save();
  return service;
}

function deleteService(id) {
  const content = load();
  const index = content.services.findIndex((s) => s.id === id);
  if (index === -1) return false;
  content.services.splice(index, 1);
  save();
  return true;
}

function addPortfolioItem({ image, alt }) {
  const content = load();
  const item = { id: genId(), image, alt: alt || '' };
  content.portfolio.push(item);
  save();
  return item;
}

function updatePortfolioItem(id, { image, alt }) {
  const content = load();
  const item = content.portfolio.find((p) => p.id === id);
  if (!item) return null;
  if (typeof image === 'string') item.image = image;
  if (typeof alt === 'string') item.alt = alt;
  save();
  return item;
}

function deletePortfolioItem(id) {
  const content = load();
  const index = content.portfolio.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const [removed] = content.portfolio.splice(index, 1);
  save();
  return removed;
}

function addContact({ label, value }) {
  const content = load();
  const contact = { id: genId(), label, value };
  content.contacts.push(contact);
  save();
  return contact;
}

function updateContact(id, { label, value }) {
  const content = load();
  const contact = content.contacts.find((c) => c.id === id);
  if (!contact) return null;
  if (typeof label === 'string') contact.label = label;
  if (typeof value === 'string') contact.value = value;
  save();
  return contact;
}

function deleteContact(id) {
  const content = load();
  const index = content.contacts.findIndex((c) => c.id === id);
  if (index === -1) return false;
  content.contacts.splice(index, 1);
  save();
  return true;
}

function moveItem(listName, id, direction) {
  const content = load();
  const arr = content[listName];
  const index = arr.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= arr.length) return false;
  [arr[index], arr[targetIndex]] = [arr[targetIndex], arr[index]];
  save();
  return true;
}

function moveContact(id, direction) {
  return moveItem('contacts', id, direction);
}

function moveService(id, direction) {
  return moveItem('services', id, direction);
}

function movePortfolioItem(id, direction) {
  return moveItem('portfolio', id, direction);
}

module.exports = {
  genId,
  getContent,
  updateAbout,
  updateServicesNote,
  updateFooterLegal,
  setHeroImage,
  addService,
  updateService,
  deleteService,
  addPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
  addContact,
  updateContact,
  deleteContact,
  moveContact,
  movePortfolioItem,
  moveService,
};
