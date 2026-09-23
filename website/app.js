import { config } from './config.js';

const species = { egg: 'Egg', baby: 'Baby', 'bubble-gomi': 'Bubble-Gomi', 'nimbus-gomi': 'Nimbus-Gomi', 'classic-gomi': 'Classic-Gomi', 'typo-ling': 'Typo-ling', 'muta-pixel': 'Muta-Pixel', 'null-sprite': 'Null-Sprite' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function sprite(evolution) {
  if (evolution === 'egg') return reducedMotion ? 'assets/egg.svg' : 'assets/egg1_idle.gif';
  if (evolution === 'baby') return reducedMotion ? 'assets/baby.svg' : 'assets/baby1_idle.gif';
  if (evolution === 'bubble-gomi') return reducedMotion ? 'assets/bubble-gomi.png' : 'assets/bubble-gomi_idle.gif';
  if (evolution === 'nimbus-gomi') return reducedMotion ? 'assets/nimbus-gomi.png' : 'assets/nimbus-gomi_idle.gif';
  return `assets/${evolution === 'null-sprite' ? 'starved' : Object.hasOwn(species, evolution) ? evolution : 'classic-gomi'}.svg`;
}
if (reducedMotion) {
  document.querySelectorAll('img[src$=".gif"]').forEach(img => { img.src = img.src.includes('egg') ? sprite('egg') : sprite('baby'); });
}
if (config.chromeStoreUrl) {
  const listing = new URL(config.chromeStoreUrl);
  if (listing.protocol === 'https:' && listing.hostname === 'chromewebstore.google.com') {
    document.querySelectorAll('a.install').forEach(link => {
      link.href = listing.href;
      link.textContent = 'Add to Chrome ↗';
    });
  }
}

let meals = 0;
const feedButton = document.querySelector('#feed-button');
feedButton.addEventListener('click', () => {
  feedButton.disabled = true;
  meals++;
  document.querySelector('#feed-card').classList.add('eaten');
  document.querySelector('#pet-speech').textContent = ['Nom nom!', 'A fine snack.', 'Thanks, friend!'][((meals - 1) % 3)];
  if (!reducedMotion) document.querySelector('#hero-pet').src = 'assets/baby1_eat.gif';
  document.querySelector('#hunger').value = Math.min(100, 45 + meals * 12);
  document.querySelector('#evolution').value = Math.min(100, 25 + meals * 8);
  document.querySelector('#demo-status').textContent = `${meals} demo ${meals === 1 ? 'meal' : 'meals'} served. One less post, one happy pet.`;
  setTimeout(() => {
    document.querySelector('#hero-pet').src = sprite('baby');
    document.querySelector('#post-copy').textContent = ['Another hot take you didn’t ask for…', 'This post could have been a snack.', 'You won’t BELIEVE this one weird trick…'][((meals - 1) % 3)];
    document.querySelector('#feed-card').classList.remove('eaten');
    feedButton.disabled = false;
  }, 1200);
});

let period = 'weekly';
let controller;
const status = document.querySelector('#board-status');
const podium = document.querySelector('#podium');
const rankings = document.querySelector('#rankings');
const tableWrap = document.querySelector('#table-wrap');
const retry = document.querySelector('#retry');
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function petImage(entry) {
  const img = node('img');
  img.src = sprite(entry.evolution);
  img.alt = '';
  return img;
}
function renderEntries(entries) {
  podium.replaceChildren();
  rankings.replaceChildren();
  entries.slice(0, 3).forEach(entry => {
    const card = node('article', 'podium-card');
    card.append(petImage(entry), node('div', 'podium-rank', `#${entry.rank}`), node('h2', 'podium-name', entry.name), node('div', 'podium-meals', `${entry.meals.toLocaleString()} meals`));
    podium.append(card);
  });
  entries.forEach(entry => {
    const row = node('tr');
    const identity = node('td');
    const inner = node('div', 'rank-identity');
    inner.append(petImage(entry), node('strong', '', entry.name));
    identity.append(inner);
    row.append(node('td', '', `#${entry.rank}`), identity, node('td', 'species-cell', species[entry.evolution] || 'GomiMon'), node('td', '', entry.meals.toLocaleString()));
    rankings.append(row);
  });
  podium.hidden = !entries.length;
  tableWrap.hidden = !entries.length;
}
async function loadLeaderboard() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const timeout = setTimeout(() => request.abort(), 12000);
  status.textContent = 'Finding the hungriest GomiMons…';
  podium.hidden = true;
  tableWrap.hidden = true;
  retry.hidden = true;
  document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === period)));
  try {
    const response = await fetch(`${config.apiBase}/v1/leaderboard?period=${period}`, { signal: request.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Leaderboard unavailable');
    const data = await response.json();
    if (!Array.isArray(data.entries) || !data.entries.every(entry => typeof entry.name === 'string' && Number.isSafeInteger(entry.rank) && entry.rank > 0 && Number.isSafeInteger(entry.meals) && entry.meals >= 0)) throw new Error('Invalid standings');
    if (controller !== request) return;
    renderEntries(data.entries);
    status.textContent = data.entries.length ? (period === 'weekly' ? 'This week’s meals · Resets Monday at 00:00 UTC' : 'Every meal counts · All-time standings') : 'No meals on the board yet. Your GomiMon could be the first!';
  } catch {
    if (controller !== request) return;
    status.textContent = 'The leaderboard couldn’t load. Try again in a moment.';
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  if (period === button.dataset.period) return;
  period = button.dataset.period;
  loadLeaderboard();
}));
retry.addEventListener('click', loadLeaderboard);
function route({ focus = false } = {}) {
  const hash = location.hash.slice(1);
  const view = ['leaderboard', 'install'].includes(hash) ? hash : 'home';
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== view; });
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.hash === location.hash) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = view === 'leaderboard' ? 'Leaderboard — GomiMon' : view === 'install' ? 'Get GomiMon — Installation' : 'GomiMon — Your feed. Their feast.';
  if (view === 'leaderboard') loadLeaderboard();
  else { controller?.abort(); controller = null; }
  if (['how-it-works', 'pricing', 'plus-details'].includes(hash)) document.getElementById(hash).scrollIntoView();
  else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (focus) {
      const heading = document.querySelector(`#${view} h1`);
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}
window.addEventListener('hashchange', () => route({ focus: true }));
route();
