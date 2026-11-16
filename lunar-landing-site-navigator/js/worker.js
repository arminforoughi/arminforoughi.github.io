// Background worker: loads and decodes the DEM, builds render grids, computes horizons and ephemerides.
import * as A from 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/esm/astronomy.js';
import { Dem, computeHorizon } from './terrain.js';
import { decodeLdm } from './demcodec.js';
import { makeEphem } from './ephem.js';
import { sampleEphem } from './analysis.js';

const E = makeEphem(A);
let dem = null;
let demLoaded;
const demReady = new Promise(r => (demLoaded = r));   // horizon requests wait for the full grid

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(total ? Math.min(1, got / total) : 0);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Block-mean downsample of the DEM heights.
function downsample(f) {
  const n = dem.n, m = Math.floor(n / f), g = new Float32Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    let s = 0;
    for (let a = 0; a < f; a++) for (let b = 0; b < f; b++) s += dem.h[(i * f + a) * n + j * f + b];
    g[i * m + j] = s / (f * f);
  }
  return { m, f, g };
}

// The full grid is ready (decoded here or on the page's helpers): build the render grids and report.
let loading = null;
function finishGrid(h, decodeMs) {
  const { meta, msg, tDl, bytes } = loading;
  if (h.length !== meta.size * meta.size) throw new Error(`Terrain grid has ${h.length} heights, expected ${meta.size ** 2}`);
  dem = new Dem(h, meta);
  demLoaded();
  const detail = downsample(msg.detailFactor);
  const mesh = msg.meshFactor ? downsample(msg.meshFactor) : null;       // used by the classic interface
  const grid = msg.wantGrid ? dem.h.slice() : null;                       // for the page's horizon helpers
  const transfer = [detail.g.buffer];
  if (mesh) transfer.push(mesh.g.buffer);
  if (grid) transfer.push(grid.buffer);
  self.postMessage({ type: 'dem', meta, detail, mesh, h: grid, timing: { downloadMs: tDl, decodeMs, bytes } }, transfer);
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'init') {
      // The preview (640 m, 0.8 MB) and the full grid (160 m) download together; the preview is drawn as soon
      // as it arrives, and horizons wait for the full grid.
      const t0 = performance.now();
      const metaP = fetch(msg.metaUrl).then(r => { if (!r.ok) throw new Error(`${msg.metaUrl}: HTTP ${r.status}`); return r.json(); });
      const fullP = fetchBytes(msg.demUrl, p => self.postMessage({ type: 'progress', p }));
      const prevBytes = await fetchBytes(msg.previewUrl, () => {});
      const meta = await metaP;
      const prev = decodeLdm(prevBytes);
      const g = Float32Array.from(prev.h);
      const f = meta.size / prev.n;
      self.postMessage({ type: 'preview', meta, mesh: { m: prev.n, f, g }, ms: performance.now() - t0 }, [g.buffer]);
      const raw = await fullP;
      const tDl = performance.now() - t0;
      self.postMessage({ type: 'progress', p: 1, stage: 'decode' });
      loading = { meta, msg, tDl, bytes: raw.length + prevBytes.length };
      if (msg.parallel) {
        // The page decodes the bands on its helper threads and sends back the grid ('grid'), or returns
        // the bytes for decoding here if that fails ('decode').
        self.postMessage({ type: 'raw', bytes: raw }, [raw.buffer]);
      } else {
        const t1 = performance.now();
        const full = decodeLdm(raw);
        finishGrid(full.h, performance.now() - t1);
      }
    } else if (msg.type === 'grid') {
      finishGrid(msg.h, msg.decodeMs);
    } else if (msg.type === 'decode') {
      loading.msg = { ...loading.msg, wantGrid: msg.wantGrid };
      const t1 = performance.now();
      const full = decodeLdm(msg.bytes);
      finishGrid(full.h, performance.now() - t1);
    } else if (msg.type === 'horizon') {
      await demReady;
      const r = computeHorizon(dem, msg.x, msg.y, msg.mast);
      self.postMessage({ type: 'horizon', id: msg.id, req: msg.req, result: r }, [r.hz.buffer]);
    } else if (msg.type === 'scan') {
      await demReady;
      // Horizons on a (2k+1)^2 grid around a point. Row 0 is the +y side of the map (toward 0°E).
      const k = msg.half, total = (2 * k + 1) ** 2, lim = dem.half - 2000, cells = [], transfer = [];
      for (let r = -k; r <= k; r++) for (let c = -k; c <= k; c++) {
        const x = msg.x + c * msg.spacing, y = msg.y - r * msg.spacing;
        if (Math.abs(x) > lim || Math.abs(y) > lim) cells.push(null);
        else {
          const h = computeHorizon(dem, x, y, msg.mast);
          cells.push({ x, y, lat: h.lat, lon: h.lon, h0: h.h0, hz: h.hz });
          transfer.push(h.hz.buffer);
        }
        self.postMessage({ type: 'scanProgress', p: cells.length / total });
      }
      self.postMessage({ type: 'scan', req: msg.req, cells }, transfer);
    } else if (msg.type === 'height') {
      await demReady;
      self.postMessage({ type: 'height', id: msg.id, h: dem.height(msg.x, msg.y) });
    } else if (msg.type === 'ephem') {
      const eph = sampleEphem(E, msg.start, msg.end, msg.step);
      self.postMessage({ type: 'ephem', req: msg.req, eph }, [eph.sun.buffer, eph.earth.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err), req: msg.req });
  }
};
