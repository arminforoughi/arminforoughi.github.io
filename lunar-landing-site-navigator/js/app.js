// Lunar Landing Site Navigator: interface.
// Three parts share one state: the stage (3D terrain + sky view), the inspector (the selected site), and the
// deck (every site on one time axis, with its numbers and best landing time).
import * as A from 'astronomy-engine';
import { makeEphem, siteFrame, azEl, discFractionAbove, SUN_R_KM } from './ephem.js';
import { toMap, horizonAt, sphereHorizon } from './terrain.js';
import { parseLdm } from './demcodec.js';
import { analyseSite, earthAngularRadius, landingScan, bestLanding, windowStats, missionSamples } from './analysis.js';
import { TerrainScene } from './scene.js';
import { Panorama, DeckChart } from './charts.js';

const E = makeEphem(A);
const R2D = 180 / Math.PI;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const X_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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
    { id: 'im2', name: 'IM-2 Athena', lat: -84.7906, lon: 29.1957, color: '#e6c229', when: '2025',
      note: 'Intuitive Machines IM-2 (NASA CLPS), landed 6 March 2025 on the Mons Mouton plateau.' },
    { id: 'im1', name: 'IM-1 Odysseus', lat: -80.13, lon: 1.44, color: '#ff8a65', when: '2024',
      note: 'Intuitive Machines IM-1 (NASA CLPS), landed 22 February 2024 near Malapert A. This is at the edge of the terrain map: ground more than about 4 km to the north is not modelled.' },
    { id: 'lcross', name: 'LCROSS impact', lat: -84.675, lon: 311.275, color: '#90a4ae', when: '2009',
      note: 'NASA LCROSS impact site in Cabeus crater, 9 October 2009, where water was detected in the ejecta.' },
  ] },
  { group: 'Elsewhere on the Moon (smooth horizon)', sites: [
    { id: 'apollo11', name: 'Apollo 11', lat: 0.6741, lon: 23.473, color: '#f48fb1', when: '1969',
      note: 'Tranquility Base, 20 July 1969. Near the equator: two weeks of day, two weeks of night, and the Earth always high in the sky.' },
    { id: 'apollo15', name: 'Apollo 15', lat: 26.1322, lon: 3.6339, color: '#b39ddb', when: '1971', note: 'Hadley–Apennine, 30 July 1971.' },
    { id: 'apollo17', name: 'Apollo 17', lat: 20.1911, lon: 30.7723, color: '#80cbc4', when: '1972', note: 'Taurus–Littrow, 11 December 1972.' },
    { id: 'blueghost', name: 'Blue Ghost M1', lat: 18.56, lon: 61.81, color: '#81d4fa', when: '2025',
      note: 'Firefly Blue Ghost Mission 1 (NASA CLPS), landed 2 March 2025 in Mare Crisium.' },
    { id: 'chandrayaan3', name: 'Chandrayaan-3', lat: -69.373, lon: 32.319, color: '#ffb74d', when: '2023', note: 'ISRO Chandrayaan-3, landed 23 August 2023.' },
    { id: 'change4', name: "Chang'e 4", lat: -45.457, lon: 177.589, color: '#ef9a9a', when: '2019',
      note: "CNSA Chang'e 4, landed 3 January 2019 on the far side, where the Earth never rises." },
    { id: 'change6', name: "Chang'e 6", lat: -41.6385, lon: 206.0148, color: '#ce93d8', when: '2024',
      note: "CNSA Chang'e 6 far-side sample return, landed June 2024 in the Apollo basin." },
  ] },
];
const LIB = new Map(LIBRARY.flatMap(g => g.sites).map(s => [s.id, s]));
const DEFAULT_IDS = ['ridge', 'degerlache', 'malapert', 'haworth', 'nobile', 'shackfloor'];
const CUSTOM_COLORS = ['#f06292', '#7c9cff', '#aed581', '#ffd54f', '#ce93d8', '#80deea', '#ff8a65', '#b0bec5'];
const SPANS = { lunation: { days: 29.530589, stepMin: 10 }, q: { days: 90, stepMin: 30 }, y: { days: 365, stepMin: 60 } };
const SPHERE_NOTE = 'Outside the south-pole terrain map: the horizon is a smooth sphere, so local hills and crater walls are not included.';
const MIN_T = Date.UTC(1990, 0, 1), MAX_T = Date.UTC(2100, 0, 1);   // sensible planning era for the ephemeris
const MAX_SITES = 16;
const SCAN = { half: 2, spacing: 400 };                             // nearby scan: 5 x 5 points, 400 m apart
const SCAN_RGB = { illum: '245,185,66', comm: '111,177,255', both: '134,214,160' };
const KEY_PHRASE = { both: 'in sunlight with Earth in view', sun: 'in sunlight', earth: 'with Earth in view' };

const state = {
  meta: null, sites: [], selectedId: null,
  span: 'y', start: utcMidnight(Date.now()), time: Date.now(), eph: null,
  mast: 2, mask: 0, playing: false, speed: 6, picking: false, customN: 0,
  missionDays: 14, planKey: 'both', touchdown: true,
  scope: 'window',          // numbers in the deck: 'window' (whole analysis window) or 'mission' (mission landing at the scene time)
  band: 'bands',            // strips in the deck: 'bands' (sunlit / Earth in view) or 'score' (landing score)
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
let demReady, previewReady, rawReady;
const demPromise = new Promise(r => (demReady = r));
const previewPromise = new Promise(r => (previewReady = r));
const rawPromise = new Promise(r => (rawReady = r));
worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') {
    $('loaderBar').style.width = `${(m.p * 100).toFixed(0)}%`;
    if (m.stage === 'decode') $('loaderTitle').textContent = 'Building terrain';
  } else if (m.type === 'preview') previewReady(m);
  else if (m.type === 'raw') rawReady(m);
  else if (m.type === 'dem') demReady(m);
  else if (m.type === 'error' && !m.req) fail(m.message);
  else if (m.req && pending.has(m.req)) {
    const p = pending.get(m.req); pending.delete(m.req);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  }
};
worker.onerror = e => fail(e.message || 'Worker failed to start');
function fail(msg) {
  if (!$('loader')) { toast(msg); return; }
  $('loader').classList.add('error');
  $('loaderTitle').textContent = 'Could not load the terrain';
  $('loaderSub').textContent = msg;
}

// ---------- helper pool ----------
// Helper workers started from this page share two jobs: decoding the bands of the terrain file while the
// app loads, then tracing horizons, each with its own copy of the grid (29 MB), so several sites or the
// cells of a nearby scan run at once. If helpers cannot start, fail, or stop answering, the main worker
// does the work instead.
const pool = { helpers: [], queue: [], next: 0 };
const JOB_TIMEOUT_MS = 20000;
function startPool() {
  const n = Math.max(0, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    let w;
    try { w = new Worker(new URL('./hzworker.js', import.meta.url), { type: 'module' }); } catch { break; }
    const helper = { w, job: null, timer: 0, dead: false };
    helper.retire = () => {
      if (helper.dead) return;
      helper.dead = true; clearTimeout(helper.timer); w.terminate();
      const job = helper.job; helper.job = null;
      if (job) job.fallback(job);
      pumpPool();
    };
    w.onmessage = ({ data: m }) => {
      const job = helper.job;
      if (!job || job.id !== m.id) return;
      clearTimeout(helper.timer); helper.job = null;
      m.error ? job.reject(new Error(m.error)) : job.resolve(m.result);
      pumpPool();
    };
    w.onerror = e => { e.preventDefault(); helper.retire(); };
    pool.helpers.push(helper);
  }
}
const liveHelpers = () => pool.helpers.filter(h => !h.dead);
function pumpPool() {
  if (!liveHelpers().length) { while (pool.queue.length) { const job = pool.queue.shift(); job.fallback(job); } return; }
  for (const helper of liveHelpers()) {
    if (helper.job || !pool.queue.length) continue;
    const job = helper.job = pool.queue.shift();
    helper.timer = setTimeout(helper.retire, JOB_TIMEOUT_MS);
    helper.w.postMessage({ ...job.msg, id: job.id });
  }
}
// Runs msg on the next free helper; fallback(job) handles it if no helper can.
function poolRun(msg, fallback) {
  return new Promise((resolve, reject) => { pool.queue.push({ id: ++pool.next, msg, resolve, reject, fallback }); pumpPool(); });
}
// Sends msg to every live helper (structured clone: each gets its own copy).
function poolBroadcast(msg) { for (const helper of liveHelpers()) helper.w.postMessage(msg); }

const hzViaWorker = job => ask({ type: 'horizon', x: job.msg.x, y: job.msg.y, mast: job.msg.mast }).then(m => job.resolve(m.result), job.reject);
function traceHorizon(x, y, mast) { return poolRun({ type: 'horizon', x, y, mast }, hzViaWorker); }

// Decodes the full terrain file's bands on the helpers; resolves with the grid, or rejects if any band
// could not be decoded there.
async function decodeOnHelpers(bytes) {
  const info = parseLdm(bytes), n = info.n, h = new Int16Array(n * n);
  poolBroadcast({ type: 'file', bytes });
  const noHelper = job => job.reject(new Error('No helper available'));
  await Promise.all(info.bands.map(b => poolRun({ type: 'band', band: b.index }, noHelper).then(r => h.set(r.h, b.firstRow * n))));
  return h;
}

// ---------- scene & charts ----------
const scene = new TerrainScene($('viewport'), $('labels'));
const pano = new Panorama($('pano'), $('panoTip'));
const deck = new DeckChart($('axis'), $('strips'), $('tlTip'), t => setTime(t), (id, t) => { select(id, false); setTime(t); });

// ---------- boot ----------
// Load timing, kept on window.lsnTiming for the speed benchmark (see tools/bench.mjs).
function loadTiming(w) {
  const at = name => Math.round(performance.getEntriesByName(name)[0]?.startTime ?? NaN);
  return {
    terrainVisibleMs: at('lsn:terrain-visible'), gridMs: at('lsn:grid'), ephemMs: at('lsn:ephem'),
    horizonsMs: at('lsn:horizons'), readyMs: at('lsn:ready'),
    downloadMs: Math.round(w.downloadMs), decodeMs: Math.round(w.decodeMs), terrainBytes: w.bytes,
  };
}
// Until the analysis is ready only the 3D view is usable; the controls around it wait.
function setBusy(on) {
  for (const el of [document.querySelector('header.bar'), $('panel'), $('deck')]) { el.inert = on; el.classList.toggle('waiting', on); }
}
(async function boot() {
  performance.mark('lsn:start');
  setBusy(true);
  startPool();
  // With two or more helpers the terrain bands are decoded on them; otherwise in the main worker.
  const parallel = liveHelpers().length >= 2;
  worker.postMessage({
    type: 'init', metaUrl: new URL('../data/dem.json', import.meta.url).href,
    previewUrl: new URL('../data/dem640.wasm', import.meta.url).href,
    demUrl: new URL('../data/dem160.wasm', import.meta.url).href, detailFactor: 2,
    parallel, wantGrid: !parallel && liveHelpers().length > 0,
  });
  // 1. The 640 m preview: draw the terrain and let people look around while the rest loads.
  const prev = await previewPromise;
  state.meta = prev.meta;
  scene.buildTerrain(prev.meta, prev.mesh, prev.mesh);
  performance.mark('lsn:terrain-visible');
  $('loader').classList.add('peek');
  $('loaderTitle').textContent = 'Loading full-resolution terrain';
  $('loaderSub').textContent = '160 m per sample · 14.4 M heights';
  if (!restoreFromHash()) {
    for (const id of DEFAULT_IDS) state.sites.push(makeSite({ ...LIB.get(id), custom: false }));
    state.selectedId = 'ridge';
  }
  const sel0 = site(state.selectedId);
  if (sel0 && !sel0.sphere) scene.focus(sel0, 70);
  setTime(state.time);
  const ephP = loadEphem();                    // the worker computes this while the full grid downloads
  // 2. The full 160 m grid: sharper shading, then horizons.
  if (parallel) {
    const { bytes } = await rawPromise, t1 = performance.now();
    let h = null;
    try { h = await decodeOnHelpers(bytes); } catch (err) { console.warn('Parallel terrain decoding failed; decoding in one worker', err); }
    if (h) {
      poolBroadcast({ type: 'dem', h, meta: state.meta });        // helpers keep a copy for horizons
      worker.postMessage({ type: 'grid', h, decodeMs: performance.now() - t1 }, [h.buffer]);
    } else {
      worker.postMessage({ type: 'decode', bytes, wantGrid: liveHelpers().length > 0 }, [bytes.buffer]);
    }
  }
  const dem = await demPromise;
  performance.mark('lsn:grid');
  if (dem.h) poolBroadcast({ type: 'dem', h: dem.h, meta: dem.meta });
  dem.h = null;
  scene.setDetail(dem.meta, dem.detail);
  $('loaderTitle').textContent = 'Tracing horizons';
  $('loaderBar').style.width = '0%';
  $('loaderSub').textContent = '1,440 rays per site across the real terrain';
  await Promise.all([ephP.then(() => performance.mark('lsn:ephem')), recomputeHorizons(() => {
    const k = state.sites.filter(s => s.hz).length;
    $('loaderTitle').textContent = `Tracing horizons · ${k} of ${state.sites.length}`;
    $('loaderBar').style.width = `${(k / state.sites.length) * 100}%`;
  })]);
  performance.mark('lsn:horizons');
  analyseAll();
  setTime(state.time);
  renderAll();
  performance.mark('lsn:ready');
  window.lsnTiming = loadTiming(dem.timing);
  setBusy(false);
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
function readySites() { return state.sites.filter(s => s.a); }

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
  const r = await traceHorizon(s.x, s.y, mast);
  s.hz = r.hz; s.h0 = r.h0; s.mast = mast;
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
  if (document.activeElement !== $('timeIn')) $('timeIn').value = new Date(state.time).toISOString().slice(0, 16);
  deck.setTime(state.time);
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
  if (h <= 0) return '0<small>h</small>';
  return h >= 48 ? `${p}${(h / 24).toFixed(1)}<small>d</small>` : `${p}${Math.round(h)}<small>h</small>`;
}
// Compact duration for a deck cell: whole days once it reaches 100 days.
function durCell(h) { return h <= 0 ? '0h' : h >= 2400 ? `${Math.round(h / 24)}d` : h >= 48 ? `${(h / 24).toFixed(1)}d` : `${Math.round(h)}h`; }
function fmtLat(lat, digits = 4) { return `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? 'S' : 'N'}`; }
function fmtDay(ms) { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtDate(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${fmtDay(ms)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function signed(v, digits = 2) { return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}°`; }

// ---------- rendering ----------
function renderAll() {
  renderDeck(); renderInspector(); renderNow(); renderSettings(); renderScan(); renderLibrary();
  scene.setMarkers(markerSites(), state.selectedId);
}

// ----- deck: rows, numbers, strips -----
const CELLS = [
  ['illum', st => pct(st.illum), 'max'],
  ['comm', st => pct(st.comm), 'max'],
  ['both', st => pct(st.both), 'max'],
  ['night', st => durCell(st.longestDarkH) + (st.darkOpen ? '+' : ''), 'min'],
  ['gap', st => durCell(st.longestGapH) + (st.gapOpen ? '+' : ''), 'min'],
];
const CELL_VAL = { illum: st => st.illum, comm: st => st.comm, both: st => st.both, night: st => st.longestDarkH, gap: st => st.longestGapH };

// Landing scan for a site, cached on its analysis (which is replaced whenever the inputs change).
function scanFor(s) {
  const a = s.a;
  if (!a._scan || a._scan.days !== state.missionDays) a._scan = { days: state.missionDays, scan: landingScan(a, state.eph, state.missionDays) };
  return a._scan.scan;
}
// { values, count, best } for a site's row, or null if the mission does not fit in the window.
function scoreFor(s) {
  const sc = scanFor(s);
  return sc ? { values: sc[state.planKey], count: sc.count, best: bestLanding(sc, s.a, state.planKey, state.touchdown), scan: sc } : null;
}
// Index of the scene time in the sampled series, and whether a mission landing then fits in the window.
function missionAtCursor() {
  const e = state.eph, m = missionSamples(e, state.missionDays);
  const i0 = Math.max(0, Math.min(e.n - 1, Math.round((state.time - e.startMs) / e.stepMs)));
  return { i0, m, fits: i0 + m <= e.n };
}

function renderDeck() {
  for (const b of $('missionSeg').children) b.classList.toggle('on', +b.dataset.v === state.missionDays);
  for (const b of $('planKeySeg').children) b.classList.toggle('on', b.dataset.v === state.planKey);
  for (const b of $('scopeSeg').children) b.classList.toggle('on', b.dataset.v === state.scope);
  for (const b of $('bandSeg').children) b.classList.toggle('on', b.dataset.v === state.band);
  if (document.activeElement !== $('missionIn')) $('missionIn').value = state.missionDays;
  $('touchdownChk').checked = state.touchdown;
  if (!state.eph) return;
  const e = state.eph, sites = readySites(), canDel = state.sites.length > 1;
  const rows = sites.map(s => ({ id: s.id, name: esc(s.name), a: s.a, selected: s.id === state.selectedId, score: scoreFor(s) }));
  $('rows').innerHTML = sites.map((s, k) => {
    const sc = rows[k].score, b = sc ? sc.best : -1;
    const best = b >= 0
      ? `<button class="r-best k-best" data-go="${e.startMs + b * e.stepMs}" title="Land ${fmtDate(e.startMs + b * e.stepMs)} UTC: over the ${state.missionDays}-day mission, sunlight ${pct(sc.scan.sun[b])}, Earth in view ${pct(sc.scan.earth[b])}, both ${pct(sc.scan.both[b])}. Click to go there.">${fmtDay(e.startMs + b * e.stepMs)}</button>`
      : `<span class="r-best k-best none" title="${sc ? 'No landing time in this window is sunlit with Earth in view at touchdown.' : 'The mission is longer than the analysis window.'}">none</span>`;
    return `<div class="row${s.id === state.selectedId ? ' selected' : ''}" data-id="${s.id}">
      ${canDel ? `<button class="r-del" title="Remove ${esc(s.name)}" aria-label="Remove ${esc(s.name)}">${X_ICON}</button>` : ''}
      <button class="r-name" title="${esc(s.name)}"><i style="background:${s.color}"></i><span>${esc(s.name)}</span>${s.sphere ? '<em class="chip" title="Outside the terrain map: smooth-sphere horizon">off map</em>' : ''}</button>
      ${CELLS.map(([k2]) => `<span class="c k-${k2}" data-k="${k2}">–</span>`).join('')}${best}</div>`;
  }).join('');
  deck.set(e, rows);
  deck.setMission(state.missionDays * 864e5);
  deck.setMode(state.band, `of a ${state.missionDays}-day mission ${KEY_PHRASE[state.planKey]}`);
  updateDeckNumbers();
  renderDeckFoot();
}

// Fill the number cells in place (no rebuild, so this is cheap enough to run while the time is moving).
function updateDeckNumbers() {
  if (!state.eph) return;
  const sites = readySites(), cur = state.scope === 'mission' ? missionAtCursor() : null;
  const stats = sites.map(s => state.scope === 'window' ? s.a.stats : cur.fits ? windowStats(s.a, state.eph, cur.i0, cur.m) : null);
  const valid = stats.filter(Boolean);
  const bestOf = Object.fromEntries(CELLS.map(([k, , dir]) => { const v = valid.map(CELL_VAL[k]); return [k, dir === 'max' ? Math.max(...v) : Math.min(...v)]; }));
  const rowEls = $('rows').children;
  sites.forEach((s, r) => {
    const el = rowEls[r], st = stats[r];
    if (!el) return;
    for (const [k, fmt] of CELLS) {
      const c = el.querySelector(`[data-k="${k}"]`), txt = st ? fmt(st) : '–';
      if (c.textContent !== txt) c.textContent = txt;
      c.classList.toggle('best', !!st && valid.length > 1 && Math.abs(CELL_VAL[k](st) - bestOf[k]) < 1e-9);
    }
  });
  const warn = cur && !cur.fits;
  if (warn !== state._cursorWarn) { state._cursorWarn = warn; renderDeckFoot(); }
}

function renderDeckFoot() {
  if (!state.eph) return;
  const d = state.missionDays, fits = state.eph.n - missionSamples(state.eph, d) + 1 >= 1;
  const parts = state.band === 'score'
    ? [`<span><i class="sw score"></i>Brighter: more of a ${d}-day mission ${KEY_PHRASE[state.planKey]} if you land then</span>`]
    : ['<span><i class="sw sun"></i>Sunlit</span>', '<span><i class="sw earth"></i>Earth in view</span>'];
  parts.push(`<span><i class="sw mission"></i>${d}-day mission from the scene time</span>`, '<span><i class="sw best"></i>Best landing time</span>');
  if (!fits) parts.push(`<span class="warn">A ${d}-day mission is longer than this window. Choose 90 days or 1 year.</span>`);
  else if (state.scope === 'mission' && state._cursorWarn) parts.push(`<span class="warn">A ${d}-day mission landing at the scene time runs past the window. Move the time earlier.</span>`);
  else parts.push(`<span>Numbers: ${state.scope === 'mission' ? `a ${d}-day mission landing at the scene time` : 'the whole window'}</span>`);
  $('deckFoot').innerHTML = parts.join('');
}

// ----- inspector: the selected site -----
function renderInspector() {
  const s = site(state.selectedId);
  if (!s) return;
  if (document.activeElement !== $('scName')) $('scName').value = s.name;
  $('scDot').style.background = s.color;
  $('scCoords').textContent = `${fmtLat(s.lat)}  ${s.lon.toFixed(3)}°E`;
  $('scTag').hidden = !s.sphere;
  $('scNote').textContent = [s.note, s.sphere ? SPHERE_NOTE : ''].filter(Boolean).join(' ');
  $('delBtn').hidden = state.sites.length < 2;
  $('focusBtn').hidden = s.sphere;
  $('scanBox').hidden = s.sphere;
  const st = s.a && s.a.stats;
  $('mIllum').textContent = st ? pct(st.illum) : '–';
  $('mComm').textContent = st ? pct(st.comm) : '–';
  $('mBoth').textContent = st ? pct(st.both) : '–';
  $('mDark').innerHTML = st ? dur(st.longestDarkH, st.darkOpen) : '–';
  $('mGap').innerHTML = st ? dur(st.longestGapH, st.gapOpen) : '–';
  $('mElev').innerHTML = s.sphere ? '–' : `${(s.h0 / 1000).toFixed(2)}<small>km</small>`;
  $('mElevSub').textContent = s.sphere ? 'not modelled off the map' : 'vs 1737.4 km sphere';
  $('panoSite').textContent = `${s.name} · ${state.mast} m above ground${s.sphere ? ' · smooth horizon' : ''}`;
  $('offMap').hidden = !s.sphere;
  if (s.sphere) $('offMap').textContent = `${s.name} is at ${fmtLat(s.lat, 2)}, outside this south-pole map. Its Sun and Earth are in the sky view below.`;
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
  if (ms === null) return { label: `No ${word.toLowerCase()} in this window`, when: '' };
  const h = (ms - state.time) / 3.6e6;
  const span = h >= 48 ? `${(h / 24).toFixed(1)} d` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.max(1, Math.round(h * 60))} min`;
  return { label: `${word} in ${span}`, when: `${fmtDate(ms)} UTC` };
}

function renderNow() {
  const s = site(state.selectedId);
  if (!s || !s.hz || !state.g) return;
  const n = nowFor(s);
  const sunOn = n.sunFrac >= 0.5;
  $('nSunState').textContent = n.sunFrac >= 0.995 ? 'Full sun' : n.sunFrac <= 0.005 ? 'In shadow' : `${Math.round(n.sunFrac * 100)}% of the disc visible`;
  $('nSunState').className = `state${sunOn ? ' on' : ''}`;
  $('nSunEl').textContent = signed(n.sunEl); $('nSunHz').textContent = signed(n.sunHz); $('nSunAz').textContent = `${n.sunAz.toFixed(1)}°`;
  $('nSunBar').style.width = `${n.sunFrac * 100}%`;
  $('nEarthState').textContent = n.earthVis ? 'In view' : 'Hidden';
  $('nEarthState').className = `state${n.earthVis ? ' on' : ''}`;
  $('nEarthEl').textContent = signed(n.earthEl); $('nEarthHz').textContent = signed(n.earthHz); $('nEarthAz').textContent = `${n.earthAz.toFixed(1)}°`;
  $('nEarthBar').style.width = `${Math.max(0, Math.min(1, (n.earthEl - n.earthHz + 2) / 10)) * 100}%`;
  if (s.a && state.eph) {
    const se = eventInfo(s, 'sun', sunOn, 'Sunrise', 'Sunset'), ee = eventInfo(s, 'earth', n.earthVis, 'Earthrise', 'Earthset');
    $('nSunNext').textContent = se.label; $('nSunWhen').textContent = se.when;
    $('nEarthNext').textContent = ee.label; $('nEarthWhen').textContent = ee.when;
  }
  pano.set({ hz: s.hz, series: s.a, now: n, centerAz: s.a ? s.a.earthCenterAz : 180 });
  if (state.scope === 'mission') updateDeckNumbers();
}

function renderSettings() {
  $('mast').value = state.mast; $('mask').value = state.mask;
  $('mastVal').textContent = `${state.mast} m`;
  $('maskVal').textContent = `${state.mask.toFixed(1)}°`;
  if (state.eph) {
    const e = state.eph;
    $('windowInfo').textContent = `${fmtDay(e.startMs)} to ${fmtDay(ephEnd())} UTC · ${e.n.toLocaleString()} steps of ${e.stepMs / 60e3} min`;
  }
  $('startDate').value = new Date(state.start).toISOString().slice(0, 10);
  for (const b of $('spanSeg').children) b.classList.toggle('on', b.dataset.v === state.span);
}

// ---------- deck interactions ----------
$('rows').addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.r-del')) { removeSite(id); return; }
  const go = e.target.closest('[data-go]');
  if (go) { select(id, false); setTime(+go.dataset.go); return; }
  select(id, !!e.target.closest('.r-name'));
});
function setMission(days) {
  if (!Number.isFinite(days)) return;
  state.missionDays = Math.max(1, Math.min(120, Math.round(days)));
  renderDeck();
}
$('missionSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMission(+b.dataset.v); });
$('missionIn').addEventListener('change', e => { setMission(parseFloat(e.target.value)); e.target.value = state.missionDays; });
$('planKeySeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.planKey = b.dataset.v; renderDeck(); } });
$('touchdownChk').addEventListener('change', e => { state.touchdown = e.target.checked; renderDeck(); });
$('scopeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.scope = b.dataset.v; state._cursorWarn = undefined; renderDeck(); } });
$('bandSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.band = b.dataset.v; renderDeck(); } });

// ---------- nearby scan ----------
async function runScan() {
  const s = site(state.selectedId);
  if (!s || s.sphere || state.scanBusy || !state.eph) return;
  state.scanBusy = true; $('scanBtn').disabled = true; $('scanBtn').textContent = 'Scanning… 0%';
  const mast = state.mast, eph = state.eph, mask = state.mask;
  try {
    // Horizons on a (2k+1)^2 grid around the site. Row 0 is the +y side of the map (toward 0°E).
    const k = SCAN.half, total = (2 * k + 1) ** 2, lim = state.meta.offset * state.meta.scale - 2000;
    let done = 0;
    const tick = v => { $('scanBtn').textContent = `Scanning… ${Math.round(++done / total * 100)}%`; return v; };
    const jobs = [];
    for (let r = -k; r <= k; r++) for (let c = -k; c <= k; c++) {
      const x = s.x + c * SCAN.spacing, y = s.y - r * SCAN.spacing;
      jobs.push(Math.abs(x) > lim || Math.abs(y) > lim ? Promise.resolve(tick(null))
        : traceHorizon(x, y, mast).then(h => tick({ x, y, lat: h.lat, lon: h.lon, h0: h.h0, hz: h.hz })));
    }
    const scanCells = await Promise.all(jobs);
    // Keep the result only if nothing it depends on changed while the scan ran.
    if (state.selectedId === s.id && state.mast === mast && state.eph === eph && state.mask === mask) {
      const cells = scanCells.map(c => c && { ...c, stats: analyseSite(eph, { lat: c.lat, lon: c.lon, h0: c.h0, mast, hz: c.hz }, mask).stats });
      state.scan = { siteId: s.id, cells };
    }
  } catch (err) { toast(err.message); }
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
  const key = state.scanMetric, rgb = SCAN_RGB[key];
  const side = 2 * SCAN.half + 1, mid = (side * side - 1) / 2;
  $('scanGrid').style.gridTemplateColumns = `repeat(${side}, 1fr)`;
  $('scanGrid').innerHTML = sc.cells.map((c, i) => {
    if (!c) return '<span class="scan-cell off" title="Outside the terrain map"></span>';
    const v = c.stats[key];
    const tip = `${fmtLat(c.lat)} ${c.lon.toFixed(3)}°E · elevation ${(c.h0 / 1000).toFixed(2)} km\nSunlight ${pct(c.stats.illum)} · Earth ${pct(c.stats.comm)} · both ${pct(c.stats.both)}${i === mid ? '\nThis is the selected site' : '\nClick to add this point as a site'}`;
    return `<button class="scan-cell${i === mid ? ' mid' : ''}" data-i="${i}" style="background:rgba(${rgb},${(0.05 + 0.75 * v).toFixed(3)})" title="${esc(tip)}">${Math.round(v * 100)}</button>`;
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
  catch (err) { toast(err.message); }
});

// ---------- selecting, renaming, removing ----------
function select(id, fly = false) {
  const s = site(id);
  if (!s) return;
  if (state.selectedId !== id) state.scan = null;
  state.selectedId = id;
  renderDeck(); renderInspector(); renderNow(); renderScan();
  scene.setMarkers(markerSites(), id);
  if (fly && !s.sphere) scene.focus(s);
}
function removeSite(id) {
  const s = site(id);
  if (!s || state.sites.length < 2) return;
  state.sites = state.sites.filter(x => x !== s);
  if (state.selectedId === id) { state.selectedId = state.sites[0].id; state.scan = null; }
  renderAll();
}
$('labels').addEventListener('click', e => { const b = e.target.closest('.site-label'); if (b) select(b.dataset.id, true); });
$('focusBtn').onclick = () => { const s = site(state.selectedId); if (s && !s.sphere) scene.focus(s); };
$('delBtn').onclick = () => removeSite(state.selectedId);
$('topBtn').onclick = () => scene.topView();
$('scName').addEventListener('input', e => {
  const s = site(state.selectedId); if (!s) return;
  s.name = e.target.value.slice(0, 40).trim() || 'Unnamed';
  renderDeck(); renderInspector(); scene.setMarkers(markerSites(), s.id);
});
$('scName').addEventListener('blur', () => renderInspector());
$('scName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

// ---------- adding sites ----------
function customDef(lat, lon, note = 'Your site. Click its name to rename it.') {
  const n = state.customN++;
  return { id: `c${Date.now().toString(36)}${n}`, name: `Site ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`,
    lat, lon, color: CUSTOM_COLORS[n % CUSTOM_COLORS.length], custom: true, note };
}
async function addSite(def, fly = true) {
  if (!state.eph || !state.meta) throw new Error('Still loading the terrain. Try again in a moment.');
  if (state.sites.length >= MAX_SITES) throw new Error(`The deck holds up to ${MAX_SITES} sites. Remove one first.`);
  const s = makeSite(def);
  await horizonFor(s);
  if (s.mast !== state.mast) await horizonFor(s);
  state.sites.push(s);
  s.a = analyseSite(state.eph, s, state.mask);
  state.selectedId = s.id; state.scan = null;
  renderAll();
  const el = $('rows').lastElementChild;
  if (el) el.scrollIntoView({ block: 'nearest' });
  if (fly && !s.sphere) scene.focus(s);
  return s;
}
function renderLibrary() {
  const have = new Set(state.sites.map(s => s.id));
  $('libList').innerHTML = LIBRARY.map(g => `<h4>${esc(g.group)}</h4>${g.sites.map(s =>
    `<button class="lib-item" data-id="${s.id}"${have.has(s.id) ? ' disabled' : ''}><i style="background:${s.color}"></i>${esc(s.name)}<span>${have.has(s.id) ? 'added' : s.when || fmtLat(s.lat, 1)}</span></button>`).join('')}`).join('');
}
function openAdd(open) {
  $('addPop').hidden = !open;
  $('addBtn').setAttribute('aria-expanded', String(open));
  if (open) { $('coordErr').hidden = true; renderLibrary(); }
}
$('addBtn').onclick = () => { if (state.picking) setPicking(false); openAdd($('addPop').hidden); };
document.addEventListener('pointerdown', e => { if (!$('addPop').hidden && !e.target.closest('.add-wrap')) openAdd(false); });
$('libList').addEventListener('click', async e => {
  const b = e.target.closest('.lib-item'); if (!b || b.disabled) return;
  const def = LIB.get(b.dataset.id);
  if (!def || site(def.id)) return;
  openAdd(false);
  try { await addSite({ ...def, custom: false }); } catch (err) { toast(err.message); }
});
function setPicking(on) {
  state.picking = on;
  $('viewport').classList.toggle('picking', on);
  $('pickHint').hidden = !on;
}
$('pickBtn').onclick = () => { openAdd(false); setPicking(true); $('viewport').scrollIntoView({ block: 'nearest' }); };
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
  try { await addSite(customDef(p.lat, p.lon), false); } catch (err) { toast(err.message); }
});
// "89.4S", "-89.4", "0.67 N", "137.4W", "222.6": a number with an optional hemisphere letter. NaN if not understood.
function parseCoord(str, pos, neg) {
  const m = String(str).trim().replace(/[−–]/g, '-').toUpperCase().match(/^([+-]?\d+(?:\.\d+)?|[+-]?\.\d+)\s*°?\s*([A-Z])?$/);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  if (m[2]) { if (m[2] === neg) v = -Math.abs(v); else if (m[2] === pos) v = Math.abs(v); else return NaN; }
  return v;
}
function formErr(msg) { $('coordErr').textContent = msg; $('coordErr').hidden = false; }
$('coordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const lat = parseCoord($('latIn').value, 'N', 'S'), lon = parseCoord($('lonIn').value, 'E', 'W');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return formErr('Enter a latitude such as -89.4 or 89.4S, and a longitude such as 222.6 or 137.4W.');
  if (lat < -90 || lat > 90) return formErr('Latitude must be between 90°S and 90°N.');
  if (lon < -360 || lon > 360) return formErr('Longitude must be between -360° and 360°.');
  try { await addSite(customDef(lat, ((lon % 360) + 360) % 360)); $('latIn').value = ''; $('lonIn').value = ''; openAdd(false); }
  catch (err) { formErr(err.message); }
});

// ---------- assumptions ----------
let mastTimer = 0;
$('mast').addEventListener('input', e => {
  state.mast = +e.target.value; state.scan = null; renderSettings(); renderScan();
  clearTimeout(mastTimer);
  mastTimer = setTimeout(async () => {
    if (await recomputeHorizons()) { analyseAll(); renderAll(); }
  }, 250);
});
$('mask').addEventListener('input', e => { state.mask = +e.target.value; state.scan = null; analyseAll(); renderAll(); });

// ---------- analysis window and scene time ----------
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
  if (!state.eph || t < state.start || t > ephEnd()) { state.start = utcMidnight(t); state.time = t; renderSettings(); changeWindow(); }
  else setTime(t);
}
$('timeIn').addEventListener('change', e => {
  const v = e.target.value;
  if (v) goToTime(Date.parse((v.length === 16 ? `${v}:00` : v) + 'Z'));
  else e.target.value = new Date(state.time).toISOString().slice(0, 16);
});
$('nowBtn').onclick = () => goToTime(Date.now());

// ---------- playback ----------
$('speedSel').onchange = e => (state.speed = +e.target.value);
$('playBtn').onclick = togglePlay;
function togglePlay() {
  if (!state.eph) return;
  state.playing = !state.playing;
  $('playIcon').innerHTML = state.playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5v14l11-7z"/>';
  if (state.playing) { lastTick = performance.now(); requestAnimationFrame(tick); }
  else renderNow();
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

// ---------- view tools ----------
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
  if (e.key === 'Escape') { if (state.picking) setPicking(false); if (!$('addPop').hidden) openAdd(false); }
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
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
  else if (act === 'plan') {
    // Show the landing score, switch the numbers to the mission, and jump to the selected site's best date.
    state.band = 'score'; state.scope = 'mission'; state._cursorWarn = undefined;
    renderDeck();
    const s = site(state.selectedId), sc = s && s.a ? scoreFor(s) : null;
    if (sc && sc.best >= 0) setTime(state.eph.startMs + sc.best * state.eph.stepMs);
  } else if (act === 'apollo') {
    if (site('apollo11')) select('apollo11');
    else { try { await addSite({ ...LIB.get('apollo11'), custom: false }); } catch (err) { toast(err.message); } }
  }
  closeGuide();
});

// ---------- shareable link ----------
// The scenario lives in the URL hash: sites (library ids, or c,lat,lon,name), the selected site's index,
// window start and span, scene time, assumptions, mission length and ranking.
function encodeState() {
  // ';' and ',' are separators, so they are written literally; site names are percent-encoded.
  return [
    ['s', state.sites.map(s => s.custom ? `c,${s.lat.toFixed(5)},${s.lon.toFixed(5)},${encodeURIComponent(s.name)}` : s.id).join(';')],
    ['sel', Math.max(0, state.sites.findIndex(s => s.id === state.selectedId))],
    ['start', new Date(state.start).toISOString().slice(0, 10)],
    ['span', state.span],
    ['t', new Date(state.time).toISOString().slice(0, 16)],
    ['mast', state.mast], ['mask', state.mask], ['days', state.missionDays],
    ['by', state.planKey], ['td', state.touchdown ? 1 : 0], ['scope', state.scope], ['show', state.band],
  ].map(([k, v]) => `${k}=${v}`).join('&');
}
// Some hosts (the published artifact page) pass only a plain "#name" hash of letters, digits and hyphens,
// so the scenario string travels base32-encoded (a–z, 2–7) after an "s-" prefix.
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function toB32(str) {
  let out = '', bits = 0, val = 0;
  for (const x of new TextEncoder().encode(str)) {
    val = (val << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function fromB32(s) {
  const out = [];
  let bits = 0, val = 0;
  for (const c of s.toLowerCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('not base32');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    val &= (1 << bits) - 1;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out));
}
const shareHash = () => `s-${toB32(encodeState())}`;
// Applies a scenario from the URL hash. Returns false (leaving the defaults) if there is none or it has no valid site.
function restoreFromHash() {
  let raw = location.hash.replace(/^#/, '');
  if (/^s-[a-z2-7]+$/i.test(raw)) { try { raw = fromB32(raw.slice(2)); } catch { return false; } }
  if (!raw) return false;
  const kv = new Map(raw.split('&').map(x => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }));
  const get = k => (kv.has(k) ? kv.get(k) : null), defs = [];
  for (const part of (get('s') || '').split(';').slice(0, MAX_SITES)) {
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
  const sel = /^\d+$/.test(get('sel') || '') ? Number(get('sel')) : 0;
  state.selectedId = state.sites[sel < state.sites.length ? sel : 0].id;
  const start = Date.parse(`${get('start')}T00:00:00Z`);
  if (Number.isFinite(start) && start >= MIN_T && start <= MAX_T) state.start = start;
  if (SPANS[get('span')]) state.span = get('span');
  const t = Date.parse(`${get('t')}:00Z`);
  state.time = Number.isFinite(t) ? t : state.start;        // setTime clamps it to the window
  const num = (k, lo, hi, d) => { const v = Number(get(k)); return get(k) !== null && get(k) !== '' && Number.isFinite(v) && v >= lo && v <= hi ? v : d; };
  state.mast = Math.round(num('mast', 0, 50, state.mast));
  state.mask = Math.round(num('mask', 0, 5, state.mask) * 2) / 2;
  state.missionDays = Math.round(num('days', 1, 120, state.missionDays));
  if (['both', 'sun', 'earth'].includes(get('by'))) state.planKey = get('by');
  if (get('td') === '0' || get('td') === '1') state.touchdown = get('td') === '1';
  if (['window', 'mission'].includes(get('scope'))) state.scope = get('scope');
  if (['bands', 'score'].includes(get('show'))) state.band = get('show');
  return true;
}
let toastTimer = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($('toast').hidden = true), 3200); }
// When the page is hosted inside another page (the published artifact), its own location is an internal
// frame URL, so the public page URL comes from <meta name="lsn:share-url">. Setting location.hash also
// updates the host page's address bar.
$('shareBtn').onclick = async () => {
  const h = shareHash();
  if (location.hash !== `#${h}`) location.hash = h;
  const base = document.querySelector('meta[name="lsn:share-url"]')?.content;
  const url = base ? `${base.replace(/#.*$/, '')}#${h}` : location.href;
  try { await navigator.clipboard.writeText(url); toast('Link to this scenario copied'); }
  catch { toast(base ? 'Copying was blocked: use Share › Copy link, which includes this scenario' : 'Link is in the address bar: copy it from there'); }
};

// ---------- CSV export of the selected site's time series ----------
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
  saveCsv(`${s.name.replace(/[^\w-]+/g, '_')}_${new Date(e.startMs).toISOString().slice(0, 10)}.csv`, lines.join('\n'));
};
// On the published artifact page the frame blocks ordinary downloads, so the file goes through the
// viewer's "downloads" capability (the viewer confirms the save). Elsewhere it is a plain blob download.
async function saveCsv(filename, text) {
  const downloads = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (downloads) {
    try { await downloads.save({ filename, data: new Blob([text], { type: 'text/csv' }) }); toast(`Saved ${filename}`); }
    catch (err) {
      const code = err && err.code;
      if (code === 'declined') return;
      toast(code === 'rate_limited' ? 'A save is already waiting for your answer' : 'Saving files is not available in this view');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
