// LOLA south-polar DEM access, projection maths and terrain-horizon computation.
// Map plane: polar stereographic (spherical, true at the pole), metres. lon = atan2(x, y), so
// x points to 90°E and y to 0°E. Heights are metres above the 1737.4 km reference sphere.

import { siteFrame } from './ephem.js';

const D2R = Math.PI / 180;
export const HZ_BINS = 720;            // 0.5° azimuth bins
export const HZ_STEP = 360 / HZ_BINS;

export class Dem {
  constructor(h, meta) {
    this.h = h; this.n = meta.size; this.scale = meta.scale; this.off = meta.offset; this.R = meta.radius;
    this.half = this.off * this.scale;    // map extent from centre to outermost sample centre (m)
  }
  // Bilinear height (m) at map point (x, y) in metres, or NaN outside the grid.
  height(x, y) {
    const c = this.off + x / this.scale, r = this.off - y / this.scale;
    const n = this.n;
    if (!(c >= 0 && r >= 0 && c <= n - 1 && r <= n - 1)) return NaN;
    let c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 === n - 1) c0--;
    if (r0 === n - 1) r0--;
    const fc = c - c0, fr = r - r0, k = r0 * n + c0, h = this.h;
    return (h[k] * (1 - fc) + h[k + 1] * fc) * (1 - fr) + (h[k + n] * (1 - fc) + h[k + n + 1] * fc) * fr;
  }
  inside(x, y) { return Math.abs(x) <= this.half && Math.abs(y) <= this.half; }
}

// lat/lon (deg) <-> map metres.
export function toMap(latDeg, lonDeg, R = 1737400) {
  const rho = 2 * R * Math.tan((90 + latDeg) * D2R / 2);
  return { x: rho * Math.sin(lonDeg * D2R), y: rho * Math.cos(lonDeg * D2R) };
}
export function toLatLon(x, y, R = 1737400) {
  const rho = Math.hypot(x, y);
  const lat = -90 + 2 * Math.atan(rho / (2 * R)) / D2R;
  let lon = Math.atan2(x, y) / D2R;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

// Terrain horizon around a map point: max elevation angle (deg) of the terrain in each 0.5° azimuth bin,
// azimuth clockwise from local north. `mast` = observer height above the local surface (m).
export function computeHorizon(dem, x0, y0, mast = 2, opts = {}) {
  const R = dem.R;
  const rays = opts.rays || 1440;
  const maxDist = opts.maxDist || 1e9;
  const h0 = dem.height(x0, y0);
  const { lat, lon } = toLatLon(x0, y0, R);
  const f = siteFrame(lat, lon, h0 + mast);           // km
  const P = f.pos.map(v => v * 1000);                 // m
  const [ux, uy, uz] = f.up, [ex, ey, ez] = f.east, [nx, ny, nz] = f.north;
  const [px, py, pz] = P;
  const sinMax = new Float64Array(HZ_BINS).fill(-2);   // max sin(elevation) per bin (monotonic in elevation)
  const H = dem.h, N = dem.n, sc = dem.scale, off = dem.off, half = dem.half;
  const K4 = 4 * R * R, R4 = 4 * R, binPerRad = HZ_BINS / (2 * Math.PI);
  for (let k = 0; k < rays; k++) {
    const th = (k + 0.5) / rays * 2 * Math.PI;
    const dx = Math.sin(th), dy = Math.cos(th);
    let s = sc;
    while (s < maxDist) {
      const x = x0 + dx * s, y = y0 + dy * s;
      if (x < -half || x > half || y < -half || y > half) break;
      // bilinear DEM height (inlined Dem.height)
      const c = off + x / sc, r = off - y / sc;
      let c0 = Math.floor(c), r0 = Math.floor(r);
      if (c0 >= N - 1) c0 = N - 2;
      if (r0 >= N - 1) r0 = N - 2;
      const fc = c - c0, fr = r - r0, q = r0 * N + c0;
      const hh = (H[q] * (1 - fc) + H[q + 1] * fc) * (1 - fr) + (H[q + N] * (1 - fc) + H[q + N + 1] * fc) * fr;
      // inverse stereographic -> body-fixed position (m)
      const rho2 = x * x + y * y, dd = rho2 + K4, rr = (R + hh) / dd;
      const vx = R4 * y * rr - px, vy = R4 * x * rr - py, vz = (rho2 - K4) * rr - pz;
      const sinEl = (vx * ux + vy * uy + vz * uz) / Math.sqrt(vx * vx + vy * vy + vz * vz);
      let a = Math.atan2(vx * ex + vy * ey + vz * ez, vx * nx + vy * ny + vz * nz);
      if (a < 0) a += 2 * Math.PI;
      let b = Math.floor(a * binPerRad);
      if (b >= HZ_BINS) b = HZ_BINS - 1;
      if (sinEl > sinMax[b]) sinMax[b] = sinEl;
      s += Math.max(sc * 0.5, s * 0.003);
    }
  }
  const hz = new Float32Array(HZ_BINS);
  for (let i = 0; i < HZ_BINS; i++) hz[i] = sinMax[i] < -1 ? -90 : Math.asin(sinMax[i]) / D2R;
  // Bins with no samples (rare): take the larger neighbour.
  for (let i = 0; i < HZ_BINS; i++) if (hz[i] === -90) {
    hz[i] = Math.max(hz[(i + HZ_BINS - 1) % HZ_BINS], hz[(i + 1) % HZ_BINS]);
  }
  return { hz, lat, lon, h0, x: x0, y: y0, mast };
}

// Horizon of a smooth sphere seen from `mast` metres above it: the same dip below level in every direction.
// Used for sites outside the terrain map.
export function sphereHorizon(mast, R = 1737400) {
  const dip = Math.acos(R / (R + Math.max(0, mast))) / D2R;
  return new Float32Array(HZ_BINS).fill(-dip);
}

// Horizon elevation at an azimuth, interpolating between bin centres.
export function horizonAt(hz, azDeg) {
  let p = azDeg / HZ_STEP - 0.5;
  if (p < 0) p += HZ_BINS;
  const i = Math.floor(p), f = p - i;
  return hz[i % HZ_BINS] * (1 - f) + hz[(i + 1) % HZ_BINS] * f;
}
