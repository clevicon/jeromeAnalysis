// Jerome Analysis — interactions and live scores

// ---------------------------------------------------------------------------
// Settings: replace these placeholder links with your real channel links
// ---------------------------------------------------------------------------
const LINKS = {
  telegram: 'https://t.me/YOUR_TELEGRAM_CHANNEL',
  whatsapp: 'https://whatsapp.com/channel/YOUR_WHATSAPP_CHANNEL',
  vip: 'https://t.me/YOUR_VIP_CONTACT',
  partner: 'mailto:partners@your-domain.com',
};

// Competitions shown in the live scores (ESPN league codes)
const LEAGUES = [
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'uefa.champions', name: 'Champions League' },
];
const REFRESH_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// General page behaviour
// ---------------------------------------------------------------------------
document.getElementById('year').textContent = new Date().getFullYear();

function applyLinks(root = document) {
  root.querySelectorAll('[data-link]').forEach(link => {
    const key = link.dataset.link;
    link.href = LINKS[key];
    if (key !== 'partner') {
      link.target = '_blank';
      link.rel = 'noopener';
    }
  });
}
applyLinks();

// Mobile navigation
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
navToggle.addEventListener('click', () => {
  const open = navMenu.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
});
navMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => navMenu.classList.remove('open')));

// League marquee
const marqueeNames = [...LEAGUES.map(l => l.name), 'Europa League', 'FA Cup', 'Copa del Rey', 'Eredivisie'];
const marqueeItems = marqueeNames
  .map(name => `<span class="marquee-item"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/></svg>${name}</span>`)
  .join('');
document.getElementById('marquee').innerHTML = marqueeItems + marqueeItems;

// Tip process tabs
const tabs = document.querySelectorAll('.tab-item');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(t => t.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  panels[tab.dataset.tab].classList.add('active');
}));

// Testimonial slider
const slides = document.querySelectorAll('.slide');
const dotsWrap = document.getElementById('dots');
let currentSlide = 0;
let autoplay;

slides.forEach((_, i) => {
  const dot = document.createElement('button');
  dot.className = 'dot' + (i === 0 ? ' active' : '');
  dot.setAttribute('aria-label', `Show review ${i + 1}`);
  dot.addEventListener('click', () => goToSlide(i));
  dotsWrap.appendChild(dot);
});
const dots = dotsWrap.querySelectorAll('.dot');

function goToSlide(index) {
  slides[currentSlide].classList.remove('active');
  dots[currentSlide].classList.remove('active');
  currentSlide = (index + slides.length) % slides.length;
  slides[currentSlide].classList.add('active');
  dots[currentSlide].classList.add('active');
  clearInterval(autoplay);
  autoplay = setInterval(() => goToSlide(currentSlide + 1), 6000);
}
document.getElementById('prev').addEventListener('click', () => goToSlide(currentSlide - 1));
document.getElementById('next').addEventListener('click', () => goToSlide(currentSlide + 1));
autoplay = setInterval(() => goToSlide(currentSlide + 1), 6000);

// Count-up numbers and scroll reveal
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const start = performance.now();
  const step = now => {
    const t = Math.min((now - start) / 1400, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('in');
    entry.target.querySelectorAll('[data-count]').forEach(countUp);
    observer.unobserve(entry.target);
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ---------------------------------------------------------------------------
// Live scores (ESPN public scoreboard feed)
// ---------------------------------------------------------------------------
let matches = [];
let activeLeague = 'all';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Date as YYYYMMDD, offset by a number of days from today
function dateKey(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function kickoff(date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function toMatch(event, league) {
  const competition = event.competitions[0];
  const side = homeAway => competition.competitors.find(c => c.homeAway === homeAway);
  const team = c => ({
    name: c.team.shortDisplayName || c.team.displayName,
    abbr: c.team.abbreviation,
    logo: c.team.logo,
    score: c.score,
  });
  return {
    league,
    date: new Date(event.date),
    state: event.status.type.state, // 'pre' | 'in' | 'post'
    status: event.status.type.shortDetail,
    home: team(side('home')),
    away: team(side('away')),
  };
}

async function fetchLeague(league) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.id}/scoreboard?dates=${dateKey(-1)}-${dateKey(6)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.events || []).map(event => toMatch(event, league));
}

// Live matches first, then upcoming (soonest first), then results (latest first)
const STATE_ORDER = { in: 0, pre: 1, post: 2 };
function byRelevance(a, b) {
  if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
  return a.state === 'post' ? b.date - a.date : a.date - b.date;
}

function crest(team) {
  const inner = team.logo
    ? `<img src="${escapeHTML(team.logo)}" alt="" loading="lazy" data-abbr="${escapeHTML(team.abbr)}">`
    : escapeHTML(team.abbr);
  return `<span class="crest">${inner}</span>`;
}

function matchRow(m) {
  const title = m.state === 'pre'
    ? `${escapeHTML(m.home.name)} vs ${escapeHTML(m.away.name)}`
    : `${escapeHTML(m.home.name)} ${escapeHTML(m.home.score)}–${escapeHTML(m.away.score)} ${escapeHTML(m.away.name)}`;
  const pill = m.state === 'in'
    ? `<span class="minute live">${escapeHTML(m.status)}</span>`
    : m.state === 'pre'
      ? `<span class="minute">${escapeHTML(kickoff(m.date))}</span>`
      : `<span class="minute ft">${escapeHTML(m.status)}</span>`;
  return `<div class="row">${crest(m.home)}<div class="row-main"><strong>${title}</strong><small>${escapeHTML(m.league.name)}</small></div>${pill}</div>`;
}

function renderList(id, list, emptyText) {
  document.getElementById(id).innerHTML = list.length
    ? list.map(matchRow).join('')
    : `<p class="empty">${emptyText}</p>`;
}

function renderFeatured(m) {
  const el = document.getElementById('heroMatch');
  if (!m) {
    el.innerHTML = '<p class="empty">No matches scheduled this week.</p>';
    return;
  }
  const label = m.state === 'in'
    ? '<span class="live-dot">LIVE</span>'
    : `<span class="state-label">${m.state === 'pre' ? 'UP NEXT' : 'FULL TIME'}</span>`;
  const centre = m.state === 'pre'
    ? `<div class="score-num vs">vs<small>${escapeHTML(kickoff(m.date))}</small></div>`
    : `<div class="score-num">${escapeHTML(m.home.score)} : ${escapeHTML(m.away.score)}<small>${escapeHTML(m.status)}</small></div>`;

  el.innerHTML = `
    <div class="live-top">${label}<span>${escapeHTML(m.league.name)}</span></div>
    <div class="score">
      <div>${crest(m.home)}<span>${escapeHTML(m.home.name)}</span></div>
      ${centre}
      <div>${crest(m.away)}<span>${escapeHTML(m.away.name)}</span></div>
    </div>
    <a class="live-cta" data-link="telegram">Get our analysts' take on Telegram
      <svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>`;
}

function renderLiveSection() {
  const filtered = activeLeague === 'all' ? matches : matches.filter(m => m.league.id === activeLeague);
  const liveAndResults = filtered.filter(m => m.state !== 'pre');
  const upcoming = filtered.filter(m => m.state === 'pre');
  const liveCount = filtered.filter(m => m.state === 'in').length;

  document.getElementById('liveCount').textContent = liveCount ? `${liveCount} live now` : 'No live matches';
  document.getElementById('upcomingCount').textContent = `${upcoming.length} fixtures`;
  renderList('liveList', liveAndResults.slice(0, 8), 'No matches in play or recent results. Check the upcoming fixtures.');
  renderList('upcomingList', upcoming.slice(0, 8), 'No upcoming fixtures in the next 7 days.');
  finishRender();
}

function renderAll() {
  renderFeatured(matches[0]);
  renderList('heroList', matches.slice(1, 4), 'No other matches right now.');
  renderList('toolsList', matches.slice(0, 5), 'No matches right now.');
  renderLiveSection();
  document.getElementById('liveUpdated').textContent =
    `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderError() {
  const message = '<p class="empty">Live scores are temporarily unavailable. Please try again shortly.</p>';
  ['heroMatch', 'heroList', 'toolsList', 'liveList', 'upcomingList'].forEach(id => {
    document.getElementById(id).innerHTML = message;
  });
  document.getElementById('liveCount').textContent = 'Offline';
  document.getElementById('liveUpdated').textContent = 'Live data unavailable';
}

// Replace broken logos with the team abbreviation, and wire up any new links
function finishRender() {
  document.querySelectorAll('.crest img:not([data-ready])').forEach(img => {
    img.dataset.ready = 'true';
    img.addEventListener('error', () => img.replaceWith(img.dataset.abbr));
  });
  applyLinks();
}

async function loadMatches() {
  const results = await Promise.allSettled(LEAGUES.map(fetchLeague));
  const loaded = results.filter(r => r.status === 'fulfilled');

  if (!loaded.length) {
    if (!matches.length) renderError();
    return;
  }
  matches = loaded
    .flatMap(r => r.value)
    .filter(m => !Number.isNaN(m.date.getTime()))
    .sort(byRelevance);
  renderAll();
}

// League filter buttons
const leagueTabs = document.getElementById('leagueTabs');
leagueTabs.innerHTML = [{ id: 'all', name: 'All Competitions' }, ...LEAGUES]
  .map(l => `<button class="league-tab${l.id === 'all' ? ' active' : ''}" data-league="${l.id}" role="tab">${l.name}</button>`)
  .join('');
leagueTabs.addEventListener('click', event => {
  const button = event.target.closest('.league-tab');
  if (!button) return;
  leagueTabs.querySelectorAll('.league-tab').forEach(b => b.classList.toggle('active', b === button));
  activeLeague = button.dataset.league;
  renderLiveSection();
});

loadMatches();
setInterval(() => {
  if (!document.hidden) loadMatches();
}, REFRESH_MS);
