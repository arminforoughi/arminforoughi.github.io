// Time-series analysis of a site: Sun visibility (power) and Earth visibility (direct-to-Earth comms).
import { siteFrame, azEl, discFractionAbove, SUN_R_KM, EARTH_R_KM } from './ephem.js';
import { horizonAt } from './terrain.js';

const R2D = 180 / Math.PI;

// Sun/Earth body-fixed vectors at evenly spaced times. Returns typed arrays (km).
export function sampleEphem(E, startMs, endMs, stepMs) {
  const n = Math.floor((endMs - startMs) / stepMs) + 1;
  const sun = new Float64Array(3 * n), earth = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const g = E.bodyFixed(new Date(startMs + i * stepMs));
    sun.set(g.sun, 3 * i); earth.set(g.earth, 3 * i);
  }
  return { startMs, stepMs, n, sun, earth };
}

// Definitions used throughout the UI:
//  * sun fraction  = fraction of the solar disc above the local terrain horizon (0..1)
//  * sunlit        = at least half the disc visible (disc centre above the terrain)
//  * Earth in view = Earth's centre at least `maskDeg` above the terrain horizon
//  * both          = sun fraction counted only while Earth is in view, so it never exceeds either of the two
export function analyseSite(eph, site, maskDeg = 0) {
  const f = siteFrame(site.lat, site.lon, site.h0 + site.mast);
  const n = eph.n;
  const sunFrac = new Float32Array(n), sunAz = new Float32Array(n), sunEl = new Float32Array(n);
  const earthAz = new Float32Array(n), earthEl = new Float32Array(n), earthVis = new Uint8Array(n);
  let sumFrac = 0, nLit = 0, nComm = 0, sumBoth = 0;
  for (let i = 0; i < n; i++) {
    const s = azEl(f, [eph.sun[3 * i], eph.sun[3 * i + 1], eph.sun[3 * i + 2]]);
    const e = azEl(f, [eph.earth[3 * i], eph.earth[3 * i + 1], eph.earth[3 * i + 2]]);
    const rSun = Math.asin(SUN_R_KM / s.dist) * R2D;
    const fr = discFractionAbove(s.el, horizonAt(site.hz, s.az), rSun);
    const vis = e.el - horizonAt(site.hz, e.az) >= maskDeg ? 1 : 0;
    sunFrac[i] = fr; sunAz[i] = s.az; sunEl[i] = s.el;
    earthAz[i] = e.az; earthEl[i] = e.el; earthVis[i] = vis;
    sumFrac += fr;
    const lit = fr >= 0.5;
    nLit += lit; nComm += vis; sumBoth += fr * vis;
  }
  const lit = i => sunFrac[i] >= 0.5;
  const com = i => earthVis[i] === 1;
  const hrs = k => k * eph.stepMs / 3.6e6;
  const dark = runs(n, i => !lit(i)), gap = runs(n, i => !com(i));
  // Circular mean of Earth's azimuth (it stays within a few degrees of one direction): used to centre charts.
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += Math.cos(earthAz[i] / R2D); cy += Math.sin(earthAz[i] / R2D); }
  const earthCenterAz = ((Math.atan2(cy, cx) * R2D) + 360) % 360;
  return {
    earthCenterAz,
    sunFrac, sunAz, sunEl, earthAz, earthEl, earthVis,
    stats: {
      illum: sumFrac / n,
      sunlit: nLit / n,
      comm: nComm / n,
      both: sumBoth / n,
      longestDarkH: hrs(dark.longest), darkOpen: dark.touchesEdge,
      longestGapH: hrs(gap.longest), gapOpen: gap.touchesEdge,
      sunWindows: windows(n, lit, eph), commWindows: windows(n, com, eph),
    },
  };
}

// Longest run of consecutive samples satisfying pred (and whether that run touches the range edge).
function runs(n, pred) {
  let longest = 0, cur = 0, start = 0, touchesEdge = false;
  for (let i = 0; i <= n; i++) {
    if (i < n && pred(i)) { if (cur === 0) start = i; cur++; }
    else {
      if (cur > longest) { longest = cur; touchesEdge = start === 0 || i === n; }
      cur = 0;
    }
  }
  return { longest, touchesEdge };
}

// Contiguous windows [startMs, endMs) where pred holds.
function windows(n, pred, eph) {
  const out = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const p = i < n && pred(i);
    if (p && s < 0) s = i;
    if (!p && s >= 0) {
      out.push([eph.startMs + s * eph.stepMs, eph.startMs + i * eph.stepMs, s === 0, i === n]);
      s = -1;
    }
  }
  return out;
}

// ---------- mission planning ----------
// Number of samples covered by a surface mission of `days`.
export function missionSamples(eph, days) { return Math.max(1, Math.round(days * 864e5 / eph.stepMs)); }

// For every possible landing sample i, the averages over the mission window [i, i + m):
//   sun   = mean fraction of the solar disc visible
//   earth = fraction of time with Earth in view
//   both  = mean fraction of the solar disc visible, counted only while Earth is in view
// Landing i is possible while the whole mission fits in the sampled range, so there are n - m + 1 of them.
export function landingScan(a, eph, days) {
  const n = eph.n, m = missionSamples(eph, days), count = n - m + 1;
  if (count < 1) return null;
  const pS = new Float64Array(n + 1), pE = new Float64Array(n + 1), pB = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    pS[i + 1] = pS[i] + a.sunFrac[i];
    pE[i + 1] = pE[i] + a.earthVis[i];
    pB[i + 1] = pB[i] + a.sunFrac[i] * a.earthVis[i];
  }
  const sun = new Float32Array(count), earth = new Float32Array(count), both = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sun[i] = (pS[i + m] - pS[i]) / m;
    earth[i] = (pE[i + m] - pE[i]) / m;
    both[i] = (pB[i + m] - pB[i]) / m;
  }
  return { m, count, sun, earth, both };
}

// Index of the best landing sample for scan[key] (earliest wins a tie), or -1 if none qualifies.
// With needTouchdown, the landing itself must be in sunlight with Earth in view.
export function bestLanding(scan, a, key, needTouchdown) {
  let best = -1, bv = -Infinity;
  const v = scan[key];
  for (let i = 0; i < scan.count; i++) {
    if (needTouchdown && !(a.sunFrac[i] >= 0.5 && a.earthVis[i] === 1)) continue;
    if (v[i] > bv + 1e-6) { bv = v[i]; best = i; }
  }
  return best;
}

// Statistics over the mission window [i0, i0 + m), which must lie inside the sampled range.
export function windowStats(a, eph, i0, m) {
  let sum = 0, comm = 0, both = 0, dark = 0, gap = 0, longDark = 0, longGap = 0;
  for (let i = i0; i < i0 + m; i++) {
    const lit = a.sunFrac[i] >= 0.5, vis = a.earthVis[i] === 1;
    sum += a.sunFrac[i]; comm += vis; both += vis ? a.sunFrac[i] : 0;
    dark = lit ? 0 : dark + 1; if (dark > longDark) longDark = dark;
    gap = vis ? 0 : gap + 1; if (gap > longGap) longGap = gap;
  }
  const hrs = k => k * eph.stepMs / 3.6e6;
  return { illum: sum / m, comm: comm / m, both: both / m, longestDarkH: hrs(longDark), longestGapH: hrs(longGap) };
}

// Earth's angular radius from the Moon (deg), for drawing.
export function earthAngularRadius(distKm) { return Math.asin(EARTH_R_KM / distKm) * R2D; }
