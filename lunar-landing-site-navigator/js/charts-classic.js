// 2D canvas charts: 360° horizon panorama and the multi-site timeline.
import { horizonAt } from './terrain.js';

const C = {
  sun: '#ffc65c', earth: '#5cb8ff', grid: 'rgba(160,180,220,0.10)', axis: '#6d7790', text: '#a7b0c3',
  cursor: '#ffffff',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fit(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------------- Panorama ----------------
export class Panorama {
  constructor(canvas, tip) {
    this.canvas = canvas; this.tip = tip; this.data = null;
    canvas.addEventListener('pointermove', e => this._hover(e));
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; this.hoverX = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  set(data) { this.data = data; this.draw(); }

  _layout(w, h) {
    const d = this.data;
    let lo = Infinity, hi = -Infinity;
    for (const v of d.hz) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    let pathHi = -Infinity;
    if (d.series) {
      const s = d.series;
      for (let i = 0; i < s.sunEl.length; i++) pathHi = Math.max(pathHi, s.sunEl[i], s.earthEl[i]);
    }
    lo = Math.min(lo, -1) - 0.8;
    hi = Math.max(hi, pathHi, 1) + 1.2;
    const L = 44, R = 10, T = 8, B = 20, c0 = (d.centerAz ?? 180) - 180;
    const wrap = a => ((a - c0) % 360 + 360) % 360;
    return { lo, hi, L, R, T, B, pw: w - L - R, ph: h - T - B, c0,
      x: az => L + wrap(az) / 360 * (w - L - R), y: el => T + (hi - el) / (hi - lo) * (h - T - B) };
  }

  draw() {
    const { ctx, w, h } = fit(this.canvas);
    ctx.clearRect(0, 0, w, h);
    if (!this.data || w < 50) return;
    const d = this.data, lay = this._layout(w, h), { x, y, L, T, pw, ph, lo, hi } = lay;
    this.lay = lay;
    // sky gradient
    const sky = ctx.createLinearGradient(0, T, 0, T + ph);
    sky.addColorStop(0, '#060912'); sky.addColorStop(1, '#0b1222');
    ctx.fillStyle = sky; ctx.fillRect(L, T, pw, ph);
    // grid
    const span = hi - lo, stepEl = span > 90 ? 15 : span > 45 ? 10 : span > 24 ? 5 : span > 12 ? 2 : 1;
    ctx.font = '10.5px JetBrains Mono, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (let e = Math.ceil(lo / stepEl) * stepEl; e <= hi; e += stepEl) {
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Math.round(y(e)) + .5); ctx.lineTo(L + pw, Math.round(y(e)) + .5); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.fillText(`${e}°`, L - 6, y(e));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const ax = a => L + (a - lay.c0) / 360 * pw;          // unwrapped position for tick placement
    for (let a = Math.ceil(lay.c0 / 30) * 30; a <= lay.c0 + 360; a += 30) {
      const an = ((a % 360) + 360) % 360, px = Math.round(ax(a)) + .5;
      ctx.strokeStyle = names[an] !== undefined ? 'rgba(160,180,220,0.18)' : C.grid;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke();
      const cardinal = names[an] !== undefined;
      if (!cardinal && pw < 520 && an % 90 !== 0) continue;     // narrow charts: cardinal labels only
      ctx.fillStyle = cardinal ? C.text : C.axis;
      ctx.font = cardinal ? '600 11px Inter, sans-serif' : '10.5px JetBrains Mono, monospace';
      ctx.fillText(names[an] || `${an}°`, Math.min(Math.max(px, L + 8), L + pw - 8), T + ph + 5);
    }
    // local level line
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#7d88a3'; ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(L + pw, y(0)); ctx.stroke(); ctx.setLineDash([]);

    // Sun and Earth paths over the window (drawn before terrain so terrain hides what's below it)
    if (d.series) {
      const s = d.series, n = s.sunAz.length, stride = Math.max(1, Math.floor(n / 9000));
      for (let i = 0; i < n; i += stride) {
        ctx.fillStyle = s.earthVis[i] ? 'rgba(92,184,255,0.55)' : 'rgba(92,184,255,0.16)';
        ctx.fillRect(x(s.earthAz[i]) - 0.75, y(s.earthEl[i]) - 0.75, 1.5, 1.5);
      }
      for (let i = 0; i < n; i += stride) {
        ctx.fillStyle = s.sunFrac[i] >= 0.5 ? 'rgba(255,198,92,0.6)' : 'rgba(255,198,92,0.16)';
        ctx.fillRect(x(s.sunAz[i]) - 0.75, y(s.sunEl[i]) - 0.75, 1.5, 1.5);
      }
    }
    // terrain silhouette
    const tg = ctx.createLinearGradient(0, y(hi), 0, T + ph);
    tg.addColorStop(0, '#9aa1b2'); tg.addColorStop(0.35, '#4a5162'); tg.addColorStop(1, '#161a24');
    ctx.beginPath(); ctx.moveTo(L, T + ph);
    for (let px = 0; px <= pw; px++) ctx.lineTo(L + px, y(horizonAt(d.hz, (lay.c0 + px / pw * 360 + 720) % 360)));
    ctx.lineTo(L + pw, T + ph); ctx.closePath();
    ctx.globalAlpha = 0.92; ctx.fillStyle = tg; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let px = 0; px <= pw; px++) { const yy = y(horizonAt(d.hz, (lay.c0 + px / pw * 360 + 720) % 360)); px ? ctx.lineTo(L + px, yy) : ctx.moveTo(L, yy); }
    ctx.strokeStyle = '#d7dbe6'; ctx.lineWidth = 1.2; ctx.stroke();

    // current Sun & Earth
    const pxPerDeg = ph / (hi - lo);
    const body = (az, el, rDeg, color, visible, glow) => {
      const cx = x(az), cy = y(el), r = Math.max(3.5, rDeg * pxPerDeg);
      if (cy - r > T + ph + 2 || cy + r < T - 2) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
      if (glow && visible) {
        const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 4.5);
        g.addColorStop(0, 'rgba(255,198,92,0.45)'); g.addColorStop(1, 'rgba(255,198,92,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = visible ? 1 : 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = visible ? '#fff' : color; ctx.setLineDash(visible ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    };
    if (d.now) {
      body(d.now.earthAz, d.now.earthEl, d.now.earthR, C.earth, d.now.earthVis, false);
      body(d.now.sunAz, d.now.sunEl, d.now.sunR, C.sun, d.now.sunFrac > 0, true);
    }
    // hover crosshair
    if (this.hoverX != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(this.hoverX + .5, T); ctx.lineTo(this.hoverX + .5, T + ph); ctx.stroke();
    }
  }

  _hover(e) {
    if (!this.data || !this.lay) return;
    const r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const { L, T, pw, ph, lo, hi } = this.lay;
    if (mx < L || mx > L + pw || my < T || my > T + ph) { this.tip.hidden = true; this.hoverX = null; this.draw(); return; }
    const az = ((this.lay.c0 + (mx - L) / pw * 360) % 360 + 360) % 360, el = hi - (my - T) / ph * (hi - lo);
    const hz = horizonAt(this.data.hz, az);
    this.hoverX = mx; this.draw();
    this.tip.hidden = false;
    this.tip.innerHTML = `az ${az.toFixed(1)}° · el ${el.toFixed(2)}°<br>terrain ${hz.toFixed(2)}° ${el > hz ? '<span style="color:#7ee0a8">clear sky</span>' : '<span style="color:#ff8fa0">blocked</span>'}`;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(mx + 12, r.width - tw - 6)}px`;
    this.tip.style.top = `${Math.max(4, my - 44)}px`;
  }
}

// ---------------- Timeline ----------------
export class Timeline {
  constructor(canvas, tip, onScrub) {
    this.canvas = canvas; this.tip = tip; this.onScrub = onScrub;
    this.rows = []; this.eph = null; this.time = 0;
    this.ROW = 26; this.TOP = 20;
    let dragging = false;
    canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); this._scrub(e); });
    canvas.addEventListener('pointermove', e => { if (dragging) this._scrub(e); this._hover(e); });
    canvas.addEventListener('pointerup', e => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  set(eph, rows) {
    this.eph = eph; this.rows = rows;
    this.canvas.style.height = `${this.TOP + Math.max(1, rows.length) * this.ROW}px`;
    this.draw();
  }
  setTime(t) { this.time = t; this.draw(); }
  // Length (ms) of the mission window drawn from the cursor, or 0 for none.
  setMission(ms) { this.mission = ms; this.draw(); }

  _x(t, w) { const e = this.eph; return (t - e.startMs) / ((e.n - 1) * e.stepMs) * w; }
  _t(px, w) { const e = this.eph; return e.startMs + Math.max(0, Math.min(1, px / w)) * (e.n - 1) * e.stepMs; }

  draw() {
    const { ctx, w, h } = fit(this.canvas);
    ctx.clearRect(0, 0, w, h);
    if (!this.eph || w < 50) return;
    const e = this.eph, TOP = this.TOP, ROW = this.ROW;
    // date ticks
    const spanDays = (e.n - 1) * e.stepMs / 864e5;
    ctx.font = '10.5px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
    const ticks = [];
    const d0 = new Date(e.startMs);
    if (spanDays > 150) {
      for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
        const t = Date.UTC(y, m, 1); if (t > e.startMs + spanDays * 864e5) break;
        const dd = new Date(t);
        ticks.push([t, dd.getUTCMonth() === 0 ? `${dd.getUTCFullYear()}` : MON[dd.getUTCMonth()], dd.getUTCMonth() === 0]);
      }
    } else {
      const step = spanDays > 45 ? 7 : 2;
      const first = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1);
      for (let t = first; t <= e.startMs + spanDays * 864e5; t += step * 864e5) {
        const dd = new Date(t); ticks.push([t, `${MON[dd.getUTCMonth()]} ${dd.getUTCDate()}`, false]);
      }
    }
    let lastEnd = -Infinity;
    for (const [t, label, major] of ticks) {
      const px = Math.round(this._x(t, w)) + .5;
      ctx.strokeStyle = major ? 'rgba(160,180,220,0.35)' : 'rgba(160,180,220,0.12)';
      ctx.beginPath(); ctx.moveTo(px, TOP - 4); ctx.lineTo(px, h); ctx.stroke();
      ctx.fillStyle = major ? '#e8ecf4' : C.axis;
      const tw = ctx.measureText(label).width;
      if (px + 4 > lastEnd + 6 && px + 4 + tw < w) { ctx.fillText(label, px + 4, 3); lastEnd = px + 4 + tw; }
    }
    // rows
    this.rows.forEach((row, r) => {
      const y0 = TOP + r * ROW + 3, hh = 9;
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0, y0, w, hh * 2 + 2);
      const s = row.a, n = e.n;
      for (let px = 0; px < w; px++) {
        const i0 = Math.floor(px / w * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * n));
        let lit = 0, com = 0;
        for (let i = i0; i < i1 && i < n; i++) { lit += s.sunFrac[i] >= 0.5; com += s.earthVis[i]; }
        const k = i1 - i0;
        if (lit) { ctx.fillStyle = `rgba(255,198,92,${0.15 + 0.85 * lit / k})`; ctx.fillRect(px, y0, 1, hh); }
        if (com) { ctx.fillStyle = `rgba(92,184,255,${0.15 + 0.85 * com / k})`; ctx.fillRect(px, y0 + hh + 2, 1, hh); }
      }
      if (row.selected) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(0.5, y0 - 1.5, w - 1, hh * 2 + 5); }
    });
    // mission window: from the scene time to the end of the surface mission
    if (this.mission > 0) {
      const x0 = this._x(this.time, w), x1 = Math.min(w, this._x(this.time + this.mission, w));
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x0, TOP - 4, x1 - x0, h - TOP + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(x1) + .5, TOP - 4); ctx.lineTo(Math.round(x1) + .5, h); ctx.stroke(); ctx.setLineDash([]);
    }
    // cursor
    const cx = Math.round(this._x(this.time, w)) + .5;
    ctx.strokeStyle = C.cursor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, TOP - 6); ctx.lineTo(cx, h); ctx.stroke();
    ctx.fillStyle = C.cursor; ctx.beginPath(); ctx.moveTo(cx - 5, TOP - 10); ctx.lineTo(cx + 5, TOP - 10); ctx.lineTo(cx, TOP - 4); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
  }

  _scrub(ev) {
    if (!this.eph) return;
    const r = this.canvas.getBoundingClientRect();
    this.onScrub(this._t(ev.clientX - r.left, r.width));
  }
  _hover(ev) {
    if (!this.eph || !this.rows.length) return;
    const r = this.canvas.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const ri = Math.floor((my - this.TOP) / this.ROW);
    const row = this.rows[ri];
    if (!row) { this.tip.hidden = true; return; }
    const t = this._t(mx, r.width), e = this.eph;
    const i = Math.max(0, Math.min(e.n - 1, Math.round((t - e.startMs) / e.stepMs)));
    const a = row.a;
    const ts = new Date(e.startMs + i * e.stepMs).toISOString().slice(0, 16).replace('T', ' ');
    this.tip.hidden = false;
    this.tip.innerHTML = `<b>${row.name}</b> · ${ts} UTC<br><span style="color:${C.sun}">Sun ${(a.sunFrac[i] * 100).toFixed(0)}% of disc</span> · <span style="color:${C.earth}">Earth ${a.earthVis[i] ? 'in view' : 'hidden'}</span>`;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(0, Math.min(mx + 12, r.width - tw - 4))}px`;
    this.tip.style.top = `${Math.max(0, this.TOP + ri * this.ROW - 40)}px`;
  }
}

// ---------------- Landing-date strip ----------------
// One row of the mission planner: x is the landing time across the analysis window, brightness is the
// mission-window score (o.values, 0..1) for landing then. Landings after o.count would overrun the window.
export function drawLandingStrip(canvas, o) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  if (w < 20) return;
  ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, w, h);
  for (let px = 0; px < w; px++) {
    const i0 = Math.floor(px / w * o.n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * o.n));
    let s = 0, k = 0;
    for (let i = i0; i < i1 && i < o.count; i++) { s += o.values[i]; k++; }
    if (!k) continue;
    const v = s / k;
    ctx.fillStyle = `rgba(${o.rgb},${(0.05 + 0.95 * v * v).toFixed(3)})`; ctx.fillRect(px, 0, 1, h);
  }
  // landings that would run past the end of the window
  const xEnd = Math.ceil(o.count / o.n * w);
  if (xEnd < w) {
    ctx.save(); ctx.beginPath(); ctx.rect(xEnd, 0, w - xEnd, h); ctx.clip();
    ctx.strokeStyle = 'rgba(160,180,220,0.22)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = xEnd - h; x < w; x += 5) { ctx.moveTo(x, h); ctx.lineTo(x + h, 0); }
    ctx.stroke(); ctx.restore();
  }
  if (o.best >= 0) {
    const bx = Math.round((o.best + 0.5) / o.n * w);
    ctx.fillStyle = '#fff'; ctx.fillRect(bx - 1, 0, 2, h);
    ctx.beginPath(); ctx.moveTo(bx - 5, 0); ctx.lineTo(bx + 5, 0); ctx.lineTo(bx, 6); ctx.closePath(); ctx.fill();
  }
  if (o.cursor >= 0) {
    const cx = Math.round(o.cursor / o.n * w) + .5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke(); ctx.setLineDash([]);
  }
}
