import * as A from 'astronomy-engine';
import { makeEphem, siteFrame, azEl, discFractionAbove, SUN_R_KM } from './ephem.js';
import { toMap, horizonAt, sphereHorizon } from './terrain.js';
import { analyseSite, earthAngularRadius, landingScan, bestLanding, windowStats, missionSamples } from './analysis.js';
import { TerrainScene } from './scene.js';
import { Panorama, Timeline, drawLandingStrip } from './charts-classic.js';

const E = makeEphem(A);
const R2D = 180 / Math.PI;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Site library. The "candidate areas" are the best-illuminated 160 m cell found on each feature by
// tools/find_sites.mjs (year 2027, 2 m height), plus Shackleton's floor for contrast. Mission coordinates
// are the published landing or impact positions. Longitudes are east-positive, 0-360.
const LIBRARY = [
  { group: 'South-pole candidate areas', sites: [
    { id: 'ridge', name: 'Shackleton ridge', lat: -89.4405, lon: 222.628, color: '#ff7a93',
      note: 'Best-lit point this tool found on the ridge between Shackleton and de Gerlache craters (2027, 2 m height).' },
    { id: 'degerlache', name: 'de Gerlache rim', lat: -88.6683, lon: 291.746, color: '#a48bff',
      note: 'Best-lit point this tool found in the rim zone of de Gerlache crater.' },
    { id: 'malapert', name: 'Malapert Massif', lat: -85.9548, lon: 356.618, color: '#3ddc97',
      note: 'Best-lit point this tool found on the ~5 km-high Malapert Massif, which faces the Earth.' },
    { id: 'haworth', name: 'Haworth rim', lat: -87.1041, lon: 335.191, color: '#ffa94d',
      note: 'Best-lit point this tool found in the rim zone of Haworth crater.' },
    { id: 'nobile', name: 'Nobile rim', lat: -86.0669, lon: 42.426, color: '#4dd0e1',
      note: 'Best-lit point this tool found in the rim zone of Nobile crater.' },
    { id: 'shackfloor', name: 'Shackleton floor', lat: -89.67, lon: 129.78, color: '#8a93a8',
      note: 'Floor of Shackleton crater: permanently shadowed and out of sight of Earth. Included for contrast.' },
  ] },
  { group: 'Missions near the south pole', sites: [
    { id: 'im2', name: 'IM-2 Athena', lat: -84.7906, lon: 29.1957, color: '#e6c229',
      note: 'Intuitive Machines IM-2 (NASA CLPS), landed 6 March 2025 on the Mons Mouton plateau.' },
    { id: 'im1', name: 'IM-1 Odysseus', lat: -80.13, lon: 1.44, color: '#ff8a65',
      note: 'Intuitive Machines IM-1 (NASA CLPS), landed 22 February 2024 near Malapert A. This is at the edge of the terrain map: ground more than about 4 km to the north is not modelled.' },
    { id: 'lcross', name: 'LCROSS impact', lat: -84.675, lon: 311.275, color: '#90a4ae',
      note: 'NASA LCROSS impact site in Cabeus crater, 9 October 2009, where water was detected in the ejecta.' },
  ] },
  { group: 'Elsewhere on the Moon (smooth horizon)', sites: [
    { id: 'apollo11', name: 'Apollo 11', lat: 0.6741, lon: 23.473, color: '#f48fb1',
      note: 'Tranquility Base, 20 July 1969. Near the equator: two weeks of day, two weeks of night, and the Earth always high in the sky.' },
    { id: 'apollo15', name: 'Apollo 15', lat: 26.1322, lon: 3.6339, color: '#b39ddb', note: 'Hadley–Apennine, 30 July 1971.' },
    { id: 'apollo17', name: 'Apollo 17', lat: 20.1911, lon: 30.7723, color: '#80cbc4', note: 'Taurus–Littrow, 11 December 1972.' },
    { id: 'blueghost', name: 'Blue Ghost M1', lat: 18.56, lon: 61.81, color: '#81d4fa',
      note: 'Firefly Blue Ghost Mission 1 (NASA CLPS), landed 2 March 2025 in Mare Crisium.' },
    { id: 'chandrayaan3', name: 'Chandrayaan-3', lat: -69.373, lon: 32.319, color: '#ffb74d', note: 'ISRO Chandrayaan-3, landed 23 August 2023.' },
    { id: 'change4', name: "Chang'e 4", lat: -45.457, lon: 177.589, color: '#ef9a9a',
      note: "CNSA Chang'e 4, landed 3 January 2019 on the far side, where the Earth never rises." },
    { id: 'change6', name: "Chang'e 6", lat: -41.6385, lon: 206.0148, color: '#ce93d8',
      note: "CNSA Chang'e 6 far-side sample return, landed June 2024 in the Apollo basin." },
  ] },
];
const LIB = new Map(LIBRARY.flatMap(g => g.sites).map(s => [s.id, s]));
const DEFAULT_IDS = ['ridge', 'degerlache', 'malapert', 'haworth', 'nobile', 'shackfloor'];
const DEFAULT_COMPARE = ['ridge', 'degerlache', 'malapert', 'shackfloor'];
const CUSTOM_COLORS = ['#f06292', '#7c9cff', '#aed581', '#ffd54f', '#ce93d8', '#80deea', '#ff8a65', '#b0bec5'];
const SPANS = { lunation: { days: 29.530589, stepMin: 10 }, q: { days: 90, stepMin: 30 }, y: { days: 365, stepMin: 60 } };
const SPHERE_NOTE = 'Outside the south-pole terrain map: the horizon is a smooth sphere, so local hills and crater walls are not included.';
const MIN_T = Date.UTC(1990, 0, 1), MAX_T = Date.UTC(2100, 0, 1);   // sensible planning era for the ephemeris
const SCAN = { half: 2, spacing: 400 };                             // nearby scan: 5 x 5 points, 400 m apart
const PLAN_RGB = { both: '126,224,168', sun: '255,198,92', earth: '92,184,255' };
const PLAN_NAME = { both: 'spent in sunlight with Earth in view', sun: 'spent in sunlight', earth: 'spent with Earth in view' };

const state = {
  meta: null, sites: [], selectedId: null, compare: new Set(),
  span: 'y', start: utcMidnight(Date.now()), time: Date.now(), eph: null,
  mast: 2, mask: 0, playing: false, speed: 6, picking: false, customN: 0,
  tab: 'site', missionDays: 14, planKey: 'both', touchdown: true,
  scan: null, scanMetric: 'illum', scanBusy: false,
};

// ---------- worker plumbing ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
function ask(msg) {
  const req = ++reqId;
  return new Promise((resolve, reject) => { pending.set(req, { resolve, reject }); worker.postMessage({ ...msg, req }); });
}
let demReady;
const demPromise = new Promise(r => (demReady = r));
worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') {
    $('loaderBar').style.width = `${(m.p * 100).toFixed(0)}%`;
    if (m.stage === 'decode') $('loaderTitle').textContent = 'Building terrain';
  } else if (m.type === 'scanProgress') {
    if (state.scanBusy) $('scanBtn').textContent = `Scanning… ${Math.round(m.p * 100)}%`;
  } else if (m.type === 'dem') demReady(m);
  else if (m.type === 'error' && !m.req) fail(m.message);
  else if (m.req && pending.has(m.req)) {
    const p = pending.get(m.req); pending.delete(m.req);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  }
};
worker.onerror = e => fail(e.message || 'Worker failed to start');
function fail(msg) {
  if (!$('loader')) return;
  $('loader').classList.add('error');
  $('loaderTitle').textContent = 'Could not load the terrain';
  $('loaderSub').textContent = msg;
}

// ---------- scene & charts ----------
const scene = new TerrainScene($('viewport'), $('labels'));
const pano = new Panorama($('pano'), $('panoTip'));
const timeline = new Timeline($('timeline'), $('tlTip'), t => setTime(t));

// ---------- boot ----------
(async function boot() {
  worker.postMessage({ type: 'init', metaUrl: new URL('../data/dem.json', import.meta.url).href, demUrl: new URL('../data/dem160.wasm', import.meta.url).href, previewUrl: new URL('../data/dem640.wasm', import.meta.url).href, meshFactor: 4, detailFactor: 2 });
  const dem = await demPromise;
  state.meta = dem.meta;
  scene.buildTerrain(dem.meta, dem.mesh, dem.detail);
  $('loaderTitle').textContent = 'Tracing horizons';
  $('loaderBar').style.width = '0%';
  $('loaderSub').textContent = '1,440 rays per site across the real terrain';
  if (!restoreFromHash()) {
    for (const id of DEFAULT_IDS) state.sites.push(makeSite({ ...LIB.get(id), custom: false }));
    state.compare = new Set(DEFAULT_COMPARE);
    state.selectedId = 'ridge';
  }
  const ephP = loadEphem();
  await Promise.all([ephP, recomputeHorizons(() => {
    const k = state.sites.filter(s => s.hz).length;
    $('loaderTitle').textContent = `Tracing horizons · ${k}/${state.sites.length}`;
    $('loaderBar').style.width = `${(k / state.sites.length) * 100}%`;
  })]);
  analyseAll();
  setTime(state.time);
  renderAll();
  const sel = site(state.selectedId);
  if (sel && !sel.sphere) scene.focus(sel, 70);
  $('loader').classList.add('done');
  setTimeout(() => $('loader').remove(), 600);
  let seen = false;
  try { seen = localStorage.getItem('lsn.guide') === '1'; } catch { /* storage unavailable */ }
  $('guide').hidden = seen;
})().catch(err => { console.error(err); fail(err.message); });

function site(id) { return state.sites.find(s => s.id === id); }
function utcMidnight(t) { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function rangeEnd() { return state.start + SPANS[state.span].days * 864e5; }
function ephEnd() { const e = state.eph; return e.startMs + (e.n - 1) * e.stepMs; }
function markerSites() { return state.sites.filter(s => s.hz && !s.sphere); }

// A site is on the terrain map if it lies inside the DEM (with a small margin); otherwise it gets a smooth-sphere horizon.
function makeSite(def) {
  const s = { ...def };
  const lim = state.meta.offset * state.meta.scale - 2000;
  let xy = null;
  if (s.lat < -75) { const p = toMap(s.lat, s.lon); if (Math.abs(p.x) <= lim && Math.abs(p.y) <= lim) xy = p; }
  s.sphere = !xy; s.x = xy ? xy.x : 0; s.y = xy ? xy.y : 0;
  return s;
}

async function loadEphem() {
  const sp = SPANS[state.span], step = sp.stepMin * 60e3;
  const end = state.start + Math.floor(sp.days * 864e5 / step) * step;
  const m = await ask({ type: 'ephem', start: state.start, end, step });
  state.eph = m.eph;
}
async function horizonFor(s) {
  const mast = state.mast;
  if (s.sphere) { s.hz = sphereHorizon(mast); s.h0 = 0; s.mast = mast; return; }
  const m = await ask({ type: 'horizon', x: s.x, y: s.y, mast });
  s.hz = m.result.hz; s.h0 = m.result.h0; s.mast = mast;
}
let hzGen = 0;
async function recomputeHorizons(onEach) {
  const gen = ++hzGen;
  await Promise.all(state.sites.map(s => horizonFor(s).then(onEach)));
  return gen === hzGen;
}
function analyseAll() {
  if (!state.eph) return;
  for (const s of state.sites) if (s.hz) s.a = analyseSite(state.eph, s, state.mask);
}

// ---------- time ----------
let lastNowRender = 0;
function setTime(t) {
  const end = state.eph ? ephEnd() : rangeEnd();
  state.time = Math.max(state.start, Math.min(end, t));
  const g = E.bodyFixed(new Date(state.time));
  state.g = g;
  const sunR = Math.asin(SUN_R_KM / Math.hypot(...g.sun)) * R2D;
  scene.setSunEarth(g.sun, g.earth, sunR, earthAngularRadius(Math.hypot(...g.earth)));
  const d = new Date(state.time).toISOString();
  $('clock').querySelector('.clock-date').textContent = d.slice(0, 10);
  $('clock').querySelector('.clock-time').textContent = d.slice(11, 16);
  if (document.activeElement !== $('timeIn')) $('timeIn').value = d.slice(0, 16);
  timeline.setTime(state.time);
  const now = performance.now();
  if (!state.playing || now - lastNowRender > 60) { lastNowRender = now; renderNow(); }
}

// Exact geometry for a site at the scene time.
function nowFor(s, g = state.g) {
  const f = siteFrame(s.lat, s.lon, s.h0 + s.mast);
  const sv = azEl(f, g.sun), ev = azEl(f, g.earth);
  const sunR = Math.asin(SUN_R_KM / sv.dist) * R2D;
  const hs = horizonAt(s.hz, sv.az), he = horizonAt(s.hz, ev.az);
  return {
    sunAz: sv.az, sunEl: sv.el, sunR, sunHz: hs, sunFrac: discFractionAbove(sv.el, hs, sunR),
    earthAz: ev.az, earthEl: ev.el, earthR: earthAngularRadius(ev.dist), earthHz: he, earthVis: ev.el - he >= state.mask,
  };
}

// ---------- formatting ----------
function pct(v) { return `${(v * 100).toFixed(v < 0.995 && v > 0.005 ? 1 : 0)}%`; }
function dur(h, open) {
  const p = open ? '≥ ' : '';
  if (h <= 0) return '0 h';
  return h >= 48 ? `${p}${(h / 24).toFixed(1)}<small>d</small>` : `${p}${Math.round(h)}<small>h</small>`;
}
function durText(h) { return dur(h).replace(/<\/?small>/g, ''); }
// Compact duration for table cells: whole days once it reaches 100 days.
function durCell(h) { return h >= 2400 ? `${Math.round(h / 24)}d` : durText(h); }
function fmtLat(lat) { return `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}`; }
function fmtDate(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function signed(v, digits = 2) { return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}°`; }

// ---------- rendering ----------
function renderAll() {
  renderList(); renderCard(); renderCompare(); renderTimeline(); renderNow(); renderSettings(); renderScan(); renderPlan();
  scene.setMarkers(markerSites(), state.selectedId);
}

function renderList() {
  const ul = $('siteList');
  ul.innerHTML = state.sites.filter(s => s.hz).map(s => `
    <li class="site-row${s.id === state.selectedId ? ' selected' : ''}" data-id="${s.id}">
      <input type="checkbox" class="chk" ${state.compare.has(s.id) ? 'checked' : ''} aria-label="Compare ${esc(s.name)}">
      <div class="name"><i style="background:${s.color}"></i><span>${esc(s.name)}</span>${s.sphere ? '<em title="Outside the terrain map: smooth-sphere horizon">off map</em>' : ''}</div>
      <div class="vals">${s.a ? `<b class="s" title="Sunlight">${pct(s.a.stats.illum)}</b><b class="e" title="Earth in view">${pct(s.a.stats.comm)}</b>` : '…'}</div>
    </li>`).join('');
  $('cmpCount').textContent = state.compare.size;
  const have = new Set(state.sites.map(s => s.id));
  $('libSel').innerHTML = '<option value="">+ Add a notable landing site…</option>' + LIBRARY.map(g =>
    `<optgroup label="${esc(g.group)}">${g.sites.map(s => `<option value="${s.id}"${have.has(s.id) ? ' disabled' : ''}>${esc(s.name)}${have.has(s.id) ? ' (added)' : ''}</option>`).join('')}</optgroup>`).join('');
}

function renderCard() {
  const s = site(state.selectedId);
  if (!s) return;
  if (document.activeElement !== $('scName')) $('scName').value = s.name;
  $('scCoords').textContent = `${fmtLat(s.lat)}  ${s.lon.toFixed(3)}°E`;
  $('scNote').textContent = [s.note, s.sphere ? SPHERE_NOTE : ''].filter(Boolean).join(' ');
  $('delBtn').hidden = state.sites.length < 2;
  $('focusBtn').hidden = s.sphere;
  $('scanBox').hidden = s.sphere;
  const st = s.a && s.a.stats;
  $('mIllum').innerHTML = st ? pct(st.illum) : '–';
  $('mComm').innerHTML = st ? pct(st.comm) : '–';
  $('mBoth').innerHTML = st ? pct(st.both) : '–';
  $('mDark').innerHTML = st ? dur(st.longestDarkH, st.darkOpen) : '–';
  $('mGap').innerHTML = st ? dur(st.longestGapH, st.gapOpen) : '–';
  $('mElev').innerHTML = s.sphere ? '–' : `${(s.h0 / 1000).toFixed(2)}<small>km</small>`;
  $('mElevSub').textContent = s.sphere ? 'not modelled off the map' : 'vs 1737.4 km sphere';
  $('panoSite').textContent = `· ${s.name} · ${state.mast} m above ground${s.sphere ? ' · smooth horizon' : ''}`;
  $('offMap').hidden = !s.sphere;
  if (s.sphere) $('offMap').textContent = `${s.name} is at ${fmtLat(s.lat).replace(/\.\d+/, m => m.slice(0, 3))}, outside this south-pole map. Its Sun and Earth are in the horizon view below.`;
}

// Next change of a site's state (sunlit or Earth in view) after the scene time. The sampled series locates
// the step where it flips; bisection with the exact geometry then pins it down to about a second.
function nextEvent(s, key, cur) {
  const e = state.eph, t = state.time, a = s.a;
  const sampled = i => key === 'sun' ? a.sunFrac[i] >= 0.5 : a.earthVis[i] === 1;
  const exact = tt => { const n = nowFor(s, E.bodyFixed(new Date(tt))); return key === 'sun' ? n.sunFrac >= 0.5 : n.earthVis; };
  const i0 = Math.max(0, Math.ceil((t - e.startMs) / e.stepMs));
  for (let i = i0; i < e.n; i++) {
    if (sampled(i) === cur) continue;
    let lo = Math.max(t, e.startMs + (i - 1) * e.stepMs), hi = e.startMs + i * e.stepMs;
    if (exact(lo) !== cur) { hi = lo; lo = t; }        // flipped earlier, between the scene time and lo
    for (let k = 0; k < 24 && hi - lo > 1000; k++) {
      const mid = (lo + hi) / 2;
      exact(mid) === cur ? (lo = mid) : (hi = mid);
    }
    return hi;
  }
  return null;
}
// { label: 'Sunset in 3.2 d', when: '18 Nov 2026 07:12 UTC' } for the next change, or a "none in window" label.
function eventInfo(s, key, cur, onWord, offWord) {
  const ms = nextEvent(s, key, cur), word = cur ? offWord : onWord;
  if (ms === null) return { label: `No ${word.toLowerCase()} in this window`, when: '', none: true };
  const h = (ms - state.time) / 3.6e6;
  const span = h >= 48 ? `${(h / 24).toFixed(1)} d` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.max(1, Math.round(h * 60))} min`;
  return { label: `${word} in ${span}`, when: `${fmtDate(ms)} UTC`, none: false };
}

function renderNow() {
  const s = site(state.selectedId);
  if (!s || !s.hz || !state.g) return;
  const n = nowFor(s);
  const sunVisPct = Math.round(n.sunFrac * 100);
  const sunOn = n.sunFrac >= 0.5;
  $('nSunState').textContent = n.sunFrac >= 0.995 ? 'Full sun' : n.sunFrac <= 0.005 ? 'Shadow' : `${sunVisPct}% disc`;
  $('nSunState').className = `pill sun${sunOn ? ' on' : ''}`;
  $('nSunEl').textContent = signed(n.sunEl);
  $('nSun').textContent = `az ${n.sunAz.toFixed(1)}° · terrain ${signed(n.sunHz)}`;
  $('nSunBar').style.width = `${n.sunFrac * 100}%`;
  $('nEarthState').textContent = n.earthVis ? 'In view' : 'Hidden';
  $('nEarthState').className = `pill earth${n.earthVis ? ' on' : ''}`;
  $('nEarthEl').textContent = signed(n.earthEl);
  $('nEarth').textContent = `az ${n.earthAz.toFixed(1)}° · terrain ${signed(n.earthHz)}`;
  const margin = n.earthEl - n.earthHz;
  $('nEarthBar').style.width = `${Math.max(0, Math.min(1, (margin + 2) / 10)) * 100}%`;
  if (s.a && state.eph) {
    const se = eventInfo(s, 'sun', sunOn, 'Sunrise', 'Sunset'), ee = eventInfo(s, 'earth', n.earthVis, 'Earthrise', 'Earthset');
    $('nSunNext').textContent = se.label; $('nSunWhen').textContent = se.when;
    $('nEarthNext').textContent = ee.label; $('nEarthWhen').textContent = ee.when;
    $('hudNow').hidden = false;
    $('hudNow').innerHTML = `<b><i style="background:${s.color}"></i>${esc(s.name)}</b>
      <span class="sun${sunOn ? ' on' : ''}"><i class="dot sun"></i>${sunOn ? 'Sunlit' : 'Dark'} · ${esc(se.label)}</span>
      <span class="earth${n.earthVis ? ' on' : ''}"><i class="dot earth"></i>${n.earthVis ? 'Earth in view' : 'Earth hidden'} · ${esc(ee.label)}</span>`;
  }
  pano.set({ hz: s.hz, series: s.a, now: n, centerAz: s.a ? s.a.earthCenterAz : 180 });
  if (state.tab === 'plan') { renderPlanNow(); drawPlanStrips(); }
}

// Sites shown as rows in the timeline and the planner: the compared ones, plus the selected one.
function rowSites() {
  let list = state.sites.filter(s => state.compare.has(s.id) && s.a);
  const sel = site(state.selectedId);
  if (sel && sel.a && !list.includes(sel)) list = [sel, ...list];
  return list;
}

function renderTimeline() {
  if (!state.eph) return;
  const rows = rowSites().map(s => ({ name: esc(s.name), a: s.a, selected: s.id === state.selectedId, id: s.id, color: s.color }));
  $('tlNames').innerHTML = rows.map(r => `<div class="tl-name${r.selected ? ' selected' : ''}" data-id="${r.id}"><i style="background:${r.color}"></i>${r.name}</div>`).join('');
  timeline.set(state.eph, rows);
}

// Comparison table. statsOf(site) returns { illum, comm, both, longestDarkH, longestGapH, darkOpen?, gapOpen? } or null.
function statTable(sites, statsOf) {
  const cols = [
    ['Sun', 'Sunlight: average fraction of the solar disc above the horizon', st => st.illum, pct, 'max'],
    ['Earth', 'Earth in view (direct-to-Earth comms possible)', st => st.comm, pct, 'max'],
    ['Both', 'Sunlight received while Earth is in view', st => st.both, pct, 'max'],
    ['Night', 'Longest continuous night (less than half the solar disc)', st => st.longestDarkH, (v, st) => durCell(v) + (st.darkOpen ? '+' : ''), 'min'],
    ['Gap', 'Longest continuous period with Earth hidden', st => st.longestGapH, (v, st) => durCell(v) + (st.gapOpen ? '+' : ''), 'min'],
  ];
  const rows = sites.map(s => [s, statsOf(s)]);
  const valid = rows.filter(r => r[1]).map(r => r[1]);
  const bests = cols.map(([, , get, , best]) => { const v = valid.map(get); return best === 'max' ? Math.max(...v) : Math.min(...v); });
  let html = `<thead><tr><th>Site</th>${cols.map(([h, t]) => `<th title="${t}">${h}</th>`).join('')}</tr></thead><tbody>`;
  for (const [s, st] of rows) {
    html += `<tr data-id="${s.id}"><td title="${esc(s.name)}"><i style="background:${s.color}"></i>${esc(s.name)}</td>${cols.map(([, , get, fmt], k) => {
      if (!st) return '<td>–</td>';
      const v = get(st);
      return `<td class="${valid.length > 1 && Math.abs(v - bests[k]) < 1e-9 ? 'best' : ''}">${fmt(v, st)}</td>`;
    }).join('')}</tr>`;
  }
  return html + '</tbody>';
}

function renderCompare() {
  const sites = state.sites.filter(s => state.compare.has(s.id) && s.a);
  const tbl = $('cmpTable');
  if (!sites.length) { tbl.innerHTML = '<tr><td class="empty">Tick sites in the list to compare them.</td></tr>'; $('cmpBars').innerHTML = ''; return; }
  tbl.innerHTML = statTable(sites, s => s.a.stats);
  const bar = (title, get, color) => `<div class="cmp-bar"><h4>${title}</h4>${sites.map(s => `
    <div class="row"><span>${esc(s.name)}</span><div class="track"><i style="width:${get(s) * 100}%;background:${color}"></i></div><span>${pct(get(s))}</span></div>`).join('')}</div>`;
  $('cmpBars').innerHTML = bar('Sunlight', s => s.a.stats.illum, 'var(--sun)') + bar('Earth in view', s => s.a.stats.comm, 'var(--earth)') + bar('Sunlight while Earth in view', s => s.a.stats.both, 'var(--both)');
}

function renderSettings() {
  $('mast').value = state.mast; $('mask').value = state.mask;
  $('mastVal').textContent = `${state.mast} m`;
  $('maskVal').textContent = `${state.mask.toFixed(1)}°`;
  if (state.eph) {
    const e = state.eph, iso = t => new Date(t).toISOString().slice(0, 10);
    $('windowInfo').textContent = `Window ${iso(e.startMs)} → ${iso(ephEnd())} UTC · ${e.n.toLocaleString()} time steps of ${e.stepMs / 60e3} min`;
  }
  $('startDate').value = new Date(state.start).toISOString().slice(0, 10);
  for (const b of $('spanSeg').children) b.classList.toggle('on', b.dataset.v === state.span);
}

// ---------- mission planner ----------
function scanFor(s) {
  const a = s.a;
  if (!a._scan || a._scan.days !== state.missionDays) a._scan = { days: state.missionDays, scan: landingScan(a, state.eph, state.missionDays) };
  return a._scan.scan;
}
function renderPlan() {
  for (const b of $('missionSeg').children) b.classList.toggle('on', +b.dataset.v === state.missionDays);
  for (const b of $('planKeySeg').children) b.classList.toggle('on', b.dataset.v === state.planKey);
  if (document.activeElement !== $('missionIn')) $('missionIn').value = state.missionDays;
  $('touchdownChk').checked = state.touchdown;
  timeline.setMission(state.tab === 'plan' ? state.missionDays * 864e5 : 0);
  if (state.tab !== 'plan' || !state.eph) return;
  const e = state.eph, m = missionSamples(e, state.missionDays), fits = e.n - m + 1 >= 1, rows = rowSites();
  $('planMsg').hidden = fits && rows.length > 0;
  $('planBody').hidden = !(fits && rows.length > 0);
  if (!fits) { $('planMsg').textContent = `A ${state.missionDays}-day mission is longer than the analysis window. Choose a longer window (90 days or 1 year) below the horizon view.`; return; }
  if (!rows.length) { $('planMsg').textContent = 'Tick sites in the Site tab to plan landing dates for them.'; return; }
  renderPlanNow();
  renderPlanBest();
}
function renderPlanNow() {
  const e = state.eph, m = missionSamples(e, state.missionDays);
  const i0 = Math.max(0, Math.min(e.n - 1, Math.round((state.time - e.startMs) / e.stepMs)));
  const fits = i0 + m <= e.n;
  $('planNowAt').textContent = `${fmtDate(state.time)} UTC`;
  $('planNowTable').innerHTML = statTable(rowSites(), s => fits ? windowStats(s.a, e, i0, m) : null);
  $('planNowNote').textContent = fits
    ? `Averages over the ${state.missionDays}-day mission, starting at the scene time. The mission is shaded on the timeline: drag the timeline to try another date.`
    : `A ${state.missionDays}-day mission landing now would run past the end of the analysis window. Move the scene time earlier or choose a longer window.`;
}
function renderPlanBest() {
  const e = state.eph, key = state.planKey;
  $('planBest').innerHTML = rowSites().map(s => {
    const sc = scanFor(s), b = bestLanding(sc, s.a, key, state.touchdown);
    s.a._best = b;
    const head = `<div class="pl-head"><i style="background:${s.color}"></i><b>${esc(s.name)}</b>${b >= 0 ? `<button class="btn small" data-go="${e.startMs + b * e.stepMs}" data-id="${s.id}">Go to date</button>` : ''}</div>`;
    const body = b >= 0
      ? `<div class="pl-when">Land <b>${fmtDate(e.startMs + b * e.stepMs)}</b> UTC</div>
         <div class="pl-stats"><span class="both">${pct(sc.both[b])} both</span><span class="sun">${pct(sc.sun[b])} sun</span><span class="earth">${pct(sc.earth[b])} Earth</span></div>`
      : '<div class="pl-when muted">No landing time in this window is sunlit with Earth in view.</div>';
    return `<div class="pl-row" data-id="${s.id}">${head}<canvas class="pl-strip" data-id="${s.id}" title="Click a date to land then"></canvas>${body}</div>`;
  }).join('');
  $('planLegend').textContent = `Each bar runs across the analysis window. Brighter means more of a ${state.missionDays}-day mission is ${PLAN_NAME[key]} if you land then. The white marker is the best landing time${state.touchdown ? ' that is sunlit with Earth in view at touchdown' : ''}; the dashed line is the scene time. Hatched dates would run past the window.`;
  drawPlanStrips();
}
function drawPlanStrips() {
  const e = state.eph;
  if (!e) return;
  const cursor = (state.time - e.startMs) / e.stepMs;
  for (const cv of $('planBest').querySelectorAll('canvas.pl-strip')) {
    const s = site(cv.dataset.id);
    if (!s || !s.a || !s.a._scan || !s.a._scan.scan) continue;
    const sc = s.a._scan.scan;
    drawLandingStrip(cv, { values: sc[state.planKey], count: sc.count, n: e.n, best: s.a._best ?? -1, cursor, rgb: PLAN_RGB[state.planKey] });
  }
}
$('planBest').addEventListener('click', ev => {
  const go = ev.target.closest('[data-go]');
  if (go) { select(go.dataset.id, false); setTime(+go.dataset.go); return; }
  const cv = ev.target.closest('canvas.pl-strip');
  if (!cv || !state.eph) return;
  const s = site(cv.dataset.id), e = state.eph, r = cv.getBoundingClientRect();
  if (!s || !s.a || !s.a._scan || !s.a._scan.scan) return;
  const i = Math.max(0, Math.min(s.a._scan.scan.count - 1, Math.floor((ev.clientX - r.left) / r.width * e.n)));
  select(s.id, false); setTime(e.startMs + i * e.stepMs);
});
function setMission(days) {
  if (!Number.isFinite(days)) return;
  state.missionDays = Math.max(1, Math.min(120, Math.round(days)));
  renderPlan();
}
$('missionSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMission(+b.dataset.v); });
$('missionIn').addEventListener('change', e => { setMission(parseFloat(e.target.value)); e.target.value = state.missionDays; });
$('planKeySeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.planKey = b.dataset.v; renderPlan(); } });
$('touchdownChk').addEventListener('change', e => { state.touchdown = e.target.checked; renderPlan(); });
$('planNowTable').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id, false); });
$('cmpTable').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id, true); });

// ---------- nearby scan ----------
async function runScan() {
  const s = site(state.selectedId);
  if (!s || s.sphere || state.scanBusy || !state.eph) return;
  state.scanBusy = true; $('scanBtn').disabled = true; $('scanBtn').textContent = 'Scanning… 0%';
  const mast = state.mast, eph = state.eph, mask = state.mask;
  try {
    const m = await ask({ type: 'scan', x: s.x, y: s.y, mast, half: SCAN.half, spacing: SCAN.spacing });
    // Keep the result only if nothing it depends on changed while the worker was busy.
    if (state.selectedId === s.id && state.mast === mast && state.eph === eph && state.mask === mask) {
      const cells = m.cells.map(c => c && { ...c, stats: analyseSite(eph, { lat: c.lat, lon: c.lon, h0: c.h0, mast, hz: c.hz }, mask).stats });
      state.scan = { siteId: s.id, cells };
    }
  } catch (err) { showCoordErr(err.message); }
  state.scanBusy = false;
  renderScan();
}
function renderScan() {
  const sc = state.scan && state.scan.siteId === state.selectedId ? state.scan : null;
  const reach = SCAN.half * SCAN.spacing;
  if (!state.scanBusy) { $('scanBtn').disabled = false; $('scanBtn').textContent = sc ? 'Scan again' : `Scan ${reach} m around this site`; }
  $('scanOut').hidden = !sc;
  if (!sc) return;
  for (const b of $('scanSeg').children) b.classList.toggle('on', b.dataset.v === state.scanMetric);
  const key = state.scanMetric, rgb = { illum: PLAN_RGB.sun, comm: PLAN_RGB.earth, both: PLAN_RGB.both }[key];
  const side = 2 * SCAN.half + 1, mid = (side * side - 1) / 2;
  $('scanGrid').style.gridTemplateColumns = `repeat(${side}, 1fr)`;
  $('scanGrid').innerHTML = sc.cells.map((c, i) => {
    if (!c) return '<span class="scan-cell off" title="Outside the terrain map"></span>';
    const v = c.stats[key];
    const tip = `${fmtLat(c.lat)} ${c.lon.toFixed(3)}°E · elevation ${(c.h0 / 1000).toFixed(2)} km\nSunlight ${pct(c.stats.illum)} · Earth ${pct(c.stats.comm)} · both ${pct(c.stats.both)}${i === mid ? '\nThis is the selected site' : '\nClick to add this point as a site'}`;
    return `<button class="scan-cell${i === mid ? ' mid' : ''}" data-i="${i}" style="background:rgba(${rgb},${(0.06 + 0.8 * v).toFixed(3)})" title="${esc(tip)}">${Math.round(v * 100)}</button>`;
  }).join('');
  const ok = sc.cells.filter(Boolean), range = k => { const v = ok.map(c => c.stats[k]); return `${pct(Math.min(...v))} to ${pct(Math.max(...v))}`; };
  $('scanCap').textContent = `Within ${reach} m, sunlight ranges from ${range('illum')} and Earth visibility from ${range('comm')}, for the same window and settings. Points are ${SCAN.spacing} m apart; up is toward 0°E (the Earth-facing side), right is toward 90°E. Click a point to add it as a site.`;
}
$('scanBtn').onclick = runScan;
$('scanSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.scanMetric = b.dataset.v; renderScan(); } });
$('scanGrid').addEventListener('click', async e => {
  const b = e.target.closest('button.scan-cell'); if (!b || !state.scan) return;
  const c = state.scan.cells[+b.dataset.i], from = site(state.scan.siteId);
  if (!c || b.classList.contains('mid')) return;
  try { await addSite(customDef(c.lat, c.lon, `Picked from the nearby scan of ${from ? from.name : 'a site'}.`), false); }
  catch (err) { showCoordErr(err.message); }
});

// ---------- interactions ----------
function select(id, fly = false) {
  const s = site(id);
  if (!s) return;
  if (state.selectedId !== id) state.scan = null;
  state.selectedId = id;
  renderList(); renderCard(); renderTimeline(); renderNow(); renderScan(); renderPlan();
  scene.setMarkers(markerSites(), id);
  if (fly && !s.sphere) scene.focus(s);
}

$('siteList').addEventListener('click', e => {
  const li = e.target.closest('.site-row'); if (!li) return;
  const id = li.dataset.id;
  if (e.target.classList.contains('chk')) {
    e.target.checked ? state.compare.add(id) : state.compare.delete(id);
    renderList(); renderCompare(); renderTimeline(); renderPlan();
    return;
  }
  select(id, true);
});
$('labels').addEventListener('click', e => { const b = e.target.closest('.site-label'); if (b) select(b.dataset.id, true); });
$('tlNames').addEventListener('click', e => { const b = e.target.closest('.tl-name'); if (b) select(b.dataset.id, false); });
$('focusBtn').onclick = () => { const s = site(state.selectedId); if (s && !s.sphere) scene.focus(s); };
$('topBtn').onclick = () => scene.topView();
$('scName').addEventListener('input', e => {
  const s = site(state.selectedId); if (!s) return;
  s.name = e.target.value.slice(0, 40).trim() || 'Unnamed';
  renderList(); renderTimeline(); renderCompare(); renderCard(); renderNow(); renderPlan(); scene.setMarkers(markerSites(), s.id);
});
$('scName').addEventListener('blur', () => renderCard());
$('delBtn').onclick = () => {
  const s = site(state.selectedId); if (!s || state.sites.length < 2) return;
  state.sites = state.sites.filter(x => x !== s); state.compare.delete(s.id);
  select(state.sites[0].id); renderCompare(); renderPlan();
};

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.panel-tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  for (const t of ['site', 'compare', 'plan']) $(`tab-${t}`).hidden = t !== tab;
  renderPlan();
}
document.querySelectorAll('.panel-tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// Adding sites
function customDef(lat, lon, note = 'Your site. Rename it above.') {
  const n = state.customN++;
  return { id: `c${Date.now().toString(36)}${n}`, name: `Site ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`,
    lat, lon, color: CUSTOM_COLORS[n % CUSTOM_COLORS.length], custom: true, note };
}
async function addSite(def, fly = true) {
  if (!state.eph || !state.meta) throw new Error('Still loading the terrain. Try again in a moment.');
  const s = makeSite(def);
  await horizonFor(s);
  if (s.mast !== state.mast) await horizonFor(s);
  state.sites.push(s);
  if (state.compare.size < 6) state.compare.add(s.id);
  s.a = analyseSite(state.eph, s, state.mask);
  state.selectedId = s.id; state.scan = null;
  renderAll();
  if (fly && !s.sphere) scene.focus(s);
  return s;
}
$('libSel').addEventListener('change', async e => {
  const def = LIB.get(e.target.value);
  e.target.value = '';
  if (!def || site(def.id)) return;
  try { await addSite({ ...def, custom: false }); } catch (err) { showCoordErr(err.message); }
});
function setPicking(on) {
  state.picking = on;
  $('viewport').classList.toggle('picking', on);
  $('pickHint').hidden = !on;
  $('addBtn').classList.toggle('active', on);
  $('addBtn').lastChild.textContent = on ? 'Cancel' : 'Drop a site';
}
$('addBtn').onclick = () => setPicking(!state.picking);
let downAt = null;
const canvasEl = () => $('viewport').querySelector('canvas');
$('viewport').addEventListener('pointerdown', e => { if (e.target === canvasEl()) downAt = [e.clientX, e.clientY]; });
$('viewport').addEventListener('pointerup', async e => {
  if (!state.picking || !downAt || e.target !== canvasEl()) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
  if (moved > 5) return;
  const p = scene.pick(e.clientX, e.clientY);
  if (!p) return;
  setPicking(false);
  try { await addSite(customDef(p.lat, p.lon), false); } catch (err) { showCoordErr(err.message); }
});
// "89.4S", "-89.4", "0.67 N", "137.4W", "222.6": a number with an optional hemisphere letter. NaN if not understood.
function parseCoord(str, pos, neg) {
  const m = String(str).trim().replace(/[−–]/g, '-').toUpperCase().match(/^([+-]?\d+(?:\.\d+)?|[+-]?\.\d+)\s*°?\s*([A-Z])?$/);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  if (m[2]) { if (m[2] === neg) v = -Math.abs(v); else if (m[2] === pos) v = Math.abs(v); else return NaN; }
  return v;
}
$('coordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const lat = parseCoord($('latIn').value, 'N', 'S'), lon = parseCoord($('lonIn').value, 'E', 'W');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return showCoordErr('Enter a latitude such as -89.4 or 89.4S, and a longitude such as 222.6 or 137.4W.');
  if (lat < -90 || lat > 90) return showCoordErr('Latitude must be between 90°S and 90°N.');
  if (lon < -360 || lon > 360) return showCoordErr('Longitude must be between -360° and 360°.');
  try { await addSite(customDef(lat, ((lon % 360) + 360) % 360)); $('latIn').value = ''; $('lonIn').value = ''; $('coordErr').hidden = true; }
  catch (err) { showCoordErr(err.message); }
});
let errTimer = 0;
function showCoordErr(msg) { $('coordErr').textContent = msg; $('coordErr').hidden = false; clearTimeout(errTimer); errTimer = setTimeout(() => ($('coordErr').hidden = true), 6000); }

// Settings
let mastTimer = 0;
$('mast').addEventListener('input', e => {
  state.mast = +e.target.value; state.scan = null; renderSettings(); renderScan();
  clearTimeout(mastTimer);
  mastTimer = setTimeout(async () => {
    if (await recomputeHorizons()) { analyseAll(); renderAll(); }
  }, 250);
});
$('mask').addEventListener('input', e => { state.mask = +e.target.value; state.scan = null; analyseAll(); renderAll(); });

// Window
let winGen = 0;
async function changeWindow() {
  const gen = ++winGen, keep = state.time;
  await loadEphem();
  if (gen !== winGen) return;          // a newer request is on its way
  state.scan = null;
  analyseAll();
  setTime(keep < state.start || keep > rangeEnd() ? state.start : keep);
  renderAll();
}
$('spanSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.span = b.dataset.v; renderSettings(); changeWindow(); });
$('startDate').addEventListener('change', e => {
  const t = Date.parse(e.target.value + 'T00:00:00Z');
  if (!Number.isFinite(t) || t < MIN_T || t > MAX_T) { renderSettings(); return; }
  state.start = t; changeWindow();
});
// Jump to an exact scene time; if it is outside the window, the window moves to start on that day.
function goToTime(t) {
  if (!Number.isFinite(t) || t < MIN_T || t > MAX_T) return;
  if (!state.eph || t < state.start || t > ephEnd()) { state.start = utcMidnight(t); state.time = t; changeWindow(); }
  else setTime(t);
}
$('timeIn').addEventListener('change', e => {
  const v = e.target.value;
  if (v) goToTime(Date.parse((v.length === 16 ? `${v}:00` : v) + 'Z'));
  else e.target.value = new Date(state.time).toISOString().slice(0, 16);
});
$('nowBtn').onclick = () => goToTime(Date.now());

// Playback
$('speedSel').onchange = e => (state.speed = +e.target.value);
$('playBtn').onclick = togglePlay;
function togglePlay() {
  if (!state.eph) return;
  state.playing = !state.playing;
  $('playIcon').innerHTML = state.playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5v14l11-7z"/>';
  if (state.playing) { lastTick = performance.now(); requestAnimationFrame(tick); }
}
let lastTick = 0;
function tick(now) {
  if (!state.playing) return;
  const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
  let t = state.time + dt * state.speed * 3.6e6;
  if (t > ephEnd()) t = state.eph.startMs;
  setTime(t);
  requestAnimationFrame(tick);
}

// Top bar toggles
$('shadingSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('shadingSeg').children) x.classList.toggle('on', x === b);
  scene.setShading(b.dataset.v);
  $('elevKey').hidden = b.dataset.v !== 'elevation';
});
$('gratBtn').onclick = () => {
  const on = $('gratBtn').getAttribute('aria-pressed') !== 'true';
  $('gratBtn').setAttribute('aria-pressed', on); scene.setGraticule(on);
};
$('aboutBtn').onclick = () => $('about').showModal();

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'Escape' && state.picking) setPicking(false);
});

// ---------- quick-start guide ----------
function closeGuide() {
  $('guide').hidden = true;
  try { localStorage.setItem('lsn.guide', '1'); } catch { /* storage unavailable */ }
}
$('guideClose').onclick = closeGuide;
$('guide').addEventListener('click', async e => {
  const b = e.target.closest('.guide-item'); if (!b || !state.eph) return;
  const act = b.dataset.act;
  if (act === 'play') { if (!state.playing) togglePlay(); }
  else if (act === 'plan') showTab('plan');
  else if (act === 'apollo') {
    showTab('site');
    if (site('apollo11')) select('apollo11');
    else { try { await addSite({ ...LIB.get('apollo11'), custom: false }); } catch (err) { showCoordErr(err.message); } }
  }
  closeGuide();
});

// ---------- shareable link ----------
// The scenario lives in the URL hash: sites (library ids, or c,lat,lon,name), compared and selected site indices,
// window start and span, scene time, assumptions and mission length.
function encodeState() {
  // ';' and ',' are separators, so they are written literally; site names are percent-encoded.
  return [
    ['s', state.sites.map(s => s.custom ? `c,${s.lat.toFixed(5)},${s.lon.toFixed(5)},${encodeURIComponent(s.name)}` : s.id).join(';')],
    ['cmp', state.sites.map((s, i) => state.compare.has(s.id) ? i : -1).filter(i => i >= 0).join(',')],
    ['sel', Math.max(0, state.sites.findIndex(s => s.id === state.selectedId))],
    ['start', new Date(state.start).toISOString().slice(0, 10)],
    ['span', state.span],
    ['t', new Date(state.time).toISOString().slice(0, 16)],
    ['mast', state.mast], ['mask', state.mask], ['days', state.missionDays],
  ].map(([k, v]) => `${k}=${v}`).join('&');
}
// Applies a scenario from the URL hash. Returns false (leaving the defaults) if there is none or it has no valid site.
function restoreFromHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return false;
  const kv = new Map(raw.split('&').map(x => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }));
  const p = { get: k => (kv.has(k) ? kv.get(k) : null) }, defs = [];
  for (const part of (p.get('s') || '').split(';').slice(0, 16)) {
    if (LIB.has(part)) { if (!defs.some(d => d.id === part)) defs.push({ ...LIB.get(part), custom: false }); continue; }
    const f = part.split(',');
    if (f[0] !== 'c' || f.length < 4) continue;
    const lat = Number(f[1]), lon = Number(f[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < 0 || lon >= 360) continue;
    const def = customDef(lat, lon);
    try { def.name = decodeURIComponent(f.slice(3).join(',')).slice(0, 40).trim() || def.name; } catch { /* keep the default name */ }
    defs.push(def);
  }
  if (!defs.length) return false;
  state.sites = defs.map(makeSite);
  const idx = str => (str || '').split(',').filter(x => /^\d+$/.test(x)).map(Number).filter(i => i < state.sites.length);
  state.compare = new Set(idx(p.get('cmp')).map(i => state.sites[i].id));
  state.selectedId = state.sites[idx(p.get('sel'))[0] ?? 0].id;
  const start = Date.parse(`${p.get('start')}T00:00:00Z`);
  if (Number.isFinite(start) && start >= MIN_T && start <= MAX_T) state.start = start;
  if (SPANS[p.get('span')]) state.span = p.get('span');
  const t = Date.parse(`${p.get('t')}:00Z`);
  state.time = Number.isFinite(t) ? t : state.start;        // setTime clamps it to the window
  const num = (k, lo, hi, d) => { const v = Number(p.get(k)); return p.get(k) !== null && Number.isFinite(v) && v >= lo && v <= hi ? v : d; };
  state.mast = Math.round(num('mast', 0, 50, state.mast));
  state.mask = Math.round(num('mask', 0, 5, state.mask) * 2) / 2;
  state.missionDays = Math.round(num('days', 1, 120, state.missionDays));
  return true;
}
let toastTimer = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($('toast').hidden = true), 2600); }
$('shareBtn').onclick = async () => {
  history.replaceState(null, '', `#${encodeState()}`);
  try { await navigator.clipboard.writeText(location.href); toast('Link to this scenario copied'); }
  catch { toast('Link is in the address bar: copy it from there'); }
};

// CSV export of the selected site's time series
$('csvBtn').onclick = () => {
  const s = site(state.selectedId), e = state.eph;
  if (!s || !s.a || !e) return;
  const lines = [
    `# Lunar Landing Site Navigator export`,
    `# site,${JSON.stringify(s.name)},lat,${s.lat},lon_east,${s.lon},ground_height_m,${s.h0.toFixed(1)},sensor_height_m,${state.mast},earth_min_elev_deg,${state.mask},horizon,${s.sphere ? 'smooth sphere (outside terrain map)' : 'LOLA terrain'}`,
    `# sun_fraction = fraction of solar disc above the horizon; earth_visible = Earth centre >= horizon + min elevation`,
    'utc,sun_az_deg,sun_el_deg,terrain_at_sun_deg,sun_fraction,earth_az_deg,earth_el_deg,terrain_at_earth_deg,earth_visible',
  ];
  const a = s.a;
  for (let i = 0; i < e.n; i++) {
    lines.push([new Date(e.startMs + i * e.stepMs).toISOString().slice(0, 16) + 'Z',
      a.sunAz[i].toFixed(3), a.sunEl[i].toFixed(4), horizonAt(s.hz, a.sunAz[i]).toFixed(4), a.sunFrac[i].toFixed(4),
      a.earthAz[i].toFixed(3), a.earthEl[i].toFixed(4), horizonAt(s.hz, a.earthAz[i]).toFixed(4), a.earthVis[i]].join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${s.name.replace(/[^\w-]+/g, '_')}_${new Date(e.startMs).toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
