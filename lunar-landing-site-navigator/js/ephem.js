// Sun & Earth geometry as seen from a site on the Moon.
// Positions: astronomy-engine (VSOP87 / truncated ELP, J2000 equatorial "EQJ").
// Lunar orientation: IAU/WGCCRE rotation model (RotationAxis), which approximates the
// Mean-Earth/Polar-Axis frame the LOLA terrain is referenced to.
// All body-fixed vectors are in km, Moon-centred, x toward 0°E, z toward the north pole.

export const MOON_R_KM = 1737.4;
export const SUN_R_KM = 695700;
export const EARTH_R_KM = 6378.137;
const AU_KM = 149597870.7;
const D2R = Math.PI / 180;

export function makeEphem(A) {
  // Body-fixed (Moon) unit axes expressed in EQJ.
  function moonAxes(time) {
    const ax = A.RotationAxis(A.Body.Moon, time);
    const a0 = ax.ra * 15 * D2R;           // ra is in sidereal hours
    const d0 = ax.dec * D2R;
    const W = ax.spin * D2R;
    const z = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
    const node = [-Math.sin(a0), Math.cos(a0), 0];       // ascending node of Moon equator on ICRF equator
    const nz = cross(z, node);
    const x = [0, 1, 2].map(i => Math.cos(W) * node[i] + Math.sin(W) * nz[i]);
    const y = cross(z, x);
    return { x, y, z };
  }

  // Sun and Earth centres in the Moon body-fixed frame (km) at a JS Date.
  function bodyFixed(date) {
    const t = A.MakeTime(date);
    const moon = A.GeoMoon(t);                                   // geometric, EQJ, AU
    const sun = A.GeoVector(A.Body.Sun, t, true);               // EQJ, AU
    const s = [sun.x - moon.x, sun.y - moon.y, sun.z - moon.z];
    const e = [-moon.x, -moon.y, -moon.z];
    const { x, y, z } = moonAxes(t);
    const toBF = v => [dot(v, x) * AU_KM, dot(v, y) * AU_KM, dot(v, z) * AU_KM];
    return { sun: toBF(s), earth: toBF(e) };
  }

  return { moonAxes, bodyFixed };
}

// Local frame of a site; latitude/longitude planetocentric degrees (east-positive), height in m above 1737.4 km.
export function siteFrame(latDeg, lonDeg, heightM = 0) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const r = MOON_R_KM + heightM / 1000;
  return { pos: up.map(c => c * r), up, east, north };
}

// Azimuth (deg, clockwise from north, 0..360), elevation (deg) and distance (km) of a body-fixed point.
export function azEl(frame, target) {
  const v = [target[0] - frame.pos[0], target[1] - frame.pos[1], target[2] - frame.pos[2]];
  const d = Math.hypot(v[0], v[1], v[2]);
  const u = dot(v, frame.up) / d;
  let az = Math.atan2(dot(v, frame.east), dot(v, frame.north)) / D2R;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, u))) / D2R, dist: d };
}

// Fraction of a uniform disc (angular radius r) above a straight horizon at height h (all deg, relative to centre).
export function discFractionAbove(centreEl, horizonEl, r) {
  const t = (centreEl - horizonEl) / r;
  if (t >= 1) return 1;
  if (t <= -1) return 0;
  // Area of the circular segment above the line, normalised by the disc area.
  return (Math.asin(t) + t * Math.sqrt(1 - t * t) + Math.PI / 2) / Math.PI;
}

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
